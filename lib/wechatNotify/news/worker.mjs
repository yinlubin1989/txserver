import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { atomicWriteJson, getStateDirectory, readCredentials, readContext } from '../channel.mjs';
import { acquireListenerLock } from '../listener.mjs';
import { deliverNews } from './delivery.mjs';

const safeCode = error => /^(NEWS_|CHANNEL_|CONTEXT_)[A-Z_]+$/u.test(error?.code || '') ? error.code : 'NEWS_WORKER_UNAVAILABLE';
const interruptedParts = parts => Object.fromEntries(Object.entries(parts || {}).map(([key, part]) =>
  [key, part.status === 'sending' ? { status: 'unknown', code: 'NEWS_INTERRUPTED' } : part]));

export async function processNewsQueue({ directory, signal, recover = false, deliver = deliverNews,
  credentials = readCredentials, context = readContext, write = atomicWriteJson, now = () => Date.now() }) {
  const journal = path.join(directory, 'requests');
  let files;
  try { files = await readdir(journal); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const records = [];
  for (const file of files) {
    if (signal?.aborted) break;
    if (!/^[a-f0-9]{64}\.json$/u.test(file)) continue;
    let record;
    try { record = JSON.parse(await readFile(path.join(journal, file), 'utf8')); }
    catch { console.warn('wechat-news', { code: 'NEWS_JOURNAL_INVALID' }); continue; }
    if (record.state === 'queued' || (recover && record.state === 'processing')) records.push({ file, record });
  }
  records.sort((a, b) => Date.parse(a.record.createdAt) - Date.parse(b.record.createdAt));
  for (const { file, record } of records) {
    if (signal?.aborted) break;
    if (recover && record.state === 'processing') {
      const parts = interruptedParts(record.body.parts);
      await write(journal, file, { state: 'finished', hash: record.hash, httpStatus: 502,
        body: { ...record.body, status: 'unknown', code: 'NEWS_INTERRUPTED', parts, completedAt: new Date(now()).toISOString() } });
      continue;
    }
    if (record.state !== 'queued') continue;
    const started = { ...record, state: 'processing', body: { ...record.body, status: 'processing',
      startedAt: new Date(now()).toISOString() } };
    await write(journal, file, started);
    try {
      // Queued content expires without sending after 24 hours, so stale news cannot surface days later.
      if (!Number.isFinite(Date.parse(record.createdAt)) || now() - Date.parse(record.createdAt) > 86400000) {
        throw Object.assign(new Error('NEWS_EXPIRED'), { code: 'NEWS_EXPIRED' });
      }
      const account = await credentials(directory), session = await context(directory);
      if (session.recipient !== account.recipient || !session.contextToken) {
        throw Object.assign(new Error('CONTEXT_REQUIRED'), { code: 'CONTEXT_REQUIRED' });
      }
      const result = await deliver(record.notification, record.body.requestId, { account, context: session, signal,
        checkpoint: async parts => {
          started.body.parts = structuredClone(parts);
          await write(journal, file, started);
        } });
      const status = result.status;
      const body = { ...started.body, status, parts: result.parts, completedAt: new Date(now()).toISOString(),
        ...(['submitted', 'unknown', 'partial'].includes(status) ? { deliveryStatus: 'unknown' } : {}) };
      // Remove the source text once the job reaches a terminal state; only status metadata remains.
      await write(journal, file, { state: 'finished', hash: record.hash, body,
        httpStatus: ['accepted', 'submitted'].includes(status) ? 202 : status === 'partial' ? 207 : 502 });
      console.info('wechat-news', { status, elapsedMs: now() - Date.parse(started.body.startedAt) });
    } catch (error) {
      // A checkpoint or final write can fail after a send. Never turn that into permission to resend.
      const status = started.body.parts ? 'unknown' : 'failed';
      await write(journal, file, { state: 'finished', hash: record.hash, httpStatus: 502,
        body: { ...started.body, status, ...(started.body.parts ? { parts: interruptedParts(started.body.parts) } : {}),
          code: safeCode(error), completedAt: new Date(now()).toISOString() } });
      console.warn('wechat-news', { code: safeCode(error) });
    }
  }
}

function pause(signal) {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, 2000);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

export async function runNewsWorker({ directory = getStateDirectory(), signal = new AbortController().signal } = {}) {
  const release = await acquireListenerLock(path.join(directory, 'news-worker'));
  try {
    let recover = true;
    while (!signal.aborted) {
      await atomicWriteJson(path.join(directory, 'news-worker'), 'health.json', { status: 'processing', checkedAt: new Date().toISOString() });
      await processNewsQueue({ directory, signal, recover });
      recover = false;
      await atomicWriteJson(path.join(directory, 'news-worker'), 'health.json', { status: 'idle', checkedAt: new Date().toISOString() });
      await pause(signal);
    }
  } finally {
    try { await atomicWriteJson(path.join(directory, 'news-worker'), 'health.json', { status: 'stopped', checkedAt: new Date().toISOString() }); }
    finally { await release(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
  runNewsWorker({ signal: controller.signal }).catch(error => {
    console.error('wechat-news', { code: safeCode(error) }); process.exitCode = 1;
  });
}
