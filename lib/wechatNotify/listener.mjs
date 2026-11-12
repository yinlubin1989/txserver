import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { atomicWriteJson, getStateDirectory, readContext, readCredentials } from './channel.mjs';
import { postWechat, WechatTransportError } from './transport.mjs';
import { createAutoReplier } from './autoReply.mjs';

/** Only the configured peer can refresh the sending context; incoming content is discarded. */
export function applyUpdates(previous, recipient, data, now = new Date().toISOString()) {
  if (!data || data.ret !== 0 || (data.errcode !== undefined && data.errcode !== 0) ||
      !Array.isArray(data.msgs) || typeof data.get_updates_buf !== 'string') {
    throw new WechatTransportError('WECHAT_INVALID_RESPONSE', '微信消息轮询结果格式无效。');
  }
  const next = previous.recipient === recipient ? { ...previous } :
    { recipient, contextToken: '', cursor: '', updatedAt: null };
  next.recipient = recipient;
  if (data.get_updates_buf) next.cursor = data.get_updates_buf;
  for (const message of data.msgs) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new WechatTransportError('WECHAT_INVALID_RESPONSE', '微信消息轮询结果格式无效。');
    }
    if (message.from_user_id !== recipient || message.message_type !== 1) continue;
    if (typeof message.context_token === 'string' && message.context_token.trim()) {
      next.contextToken = message.context_token;
      next.updatedAt = now;
    }
  }
  return next;
}

/** Refuse existing locks, including stale ones: never risk two consumers using one cursor. */
export async function acquireListenerLock(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, 'listener.lock');
  const identity = `${process.pid}:${randomUUID()}`;
  let handle;
  try { handle = await open(filename, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new WechatTransportError('LISTENER_LOCKED', '微信监听器已有锁；确认旧进程已退出后再清理锁。', 503);
    throw error;
  }
  try { await handle.writeFile(identity); await handle.sync(); }
  finally { await handle.close(); }
  return async () => {
    try { if (await readFile(filename, 'utf8') === identity) await unlink(filename); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
}

function pause(ms, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

export async function runListener({ directory = getStateDirectory(), signal = new AbortController().signal,
  post = postWechat, wait = pause, autoReply = process.env.WECHAT_NOTIFY_AUTO_REPLY === 'true', reply } = {}) {
  const startedAt = Date.now();
  const respond = autoReply ? reply || createAutoReplier({ directory, startedAt, signal }) : null;
  const release = await acquireListenerLock(directory);
  try {
    const account = await readCredentials(directory);
    let context = await readContext(directory);
    if (context.recipient !== account.recipient) context = { recipient: account.recipient, contextToken: '', cursor: '', updatedAt: null };
    while (!signal.aborted) {
      let delay = 1000;
      try {
        const data = await post(account.botToken, 'getupdates', { get_updates_buf: context.cursor }, { timeoutMs: 35000, signal });
        if (signal.aborted) break;
        const next = applyUpdates(context, account.recipient, data);
        await atomicWriteJson(directory, 'context.json', next);
        context = next;
        await atomicWriteJson(directory, 'health.json', { status: 'connected', code: null, checkedAt: new Date().toISOString() });
        // Cursor is durable before AI/send: after a crash we may omit a reply, never replay backlog.
        if (respond && !signal.aborted) await respond(data.msgs, account, context);
      } catch (error) {
        if (signal.aborted) break;
        const code = error instanceof WechatTransportError ? error.code : 'LISTENER_UNAVAILABLE';
        await atomicWriteJson(directory, 'health.json', { status: 'error', code, checkedAt: new Date().toISOString() });
        // Poll timeouts are normal idle events, not successful responses or cursor advances.
        delay = code === 'WECHAT_LOGIN_REQUIRED' ? 3600000 : code === 'WECHAT_TIMEOUT' ? 1000 : 30000;
        if (code !== 'WECHAT_TIMEOUT') console.warn('wechat-listener', { code });
      }
      await wait(delay, signal);
    }
  } finally {
    await release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  runListener({ signal: controller.signal }).catch(error => {
    console.error('wechat-listener', { code: error instanceof WechatTransportError ? error.code : 'LISTENER_UNAVAILABLE' });
    process.exitCode = 1;
  });
}
