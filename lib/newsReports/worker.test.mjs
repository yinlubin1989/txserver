import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import { acquireReportLock, processReportQueue } from './worker.mjs';
import { createReport, readReport, writeReport, listIdleReports, listPendingReports, queueReportAudio } from './storage.mjs';
import { processNarration } from './narration.mjs';

async function fixture(t, prefix = 'report-lock-') {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function fakeHolder({ conflict = false } = {}) {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough();
  child.kill = () => child.emit('close', null, 'SIGKILL');
  child.stdin.on('finish', () => { child.emit('exit', 0, null); child.emit('close', 0, null); });
  child.start = () => queueMicrotask(() => conflict ? child.emit('close', 73, null) : child.stdout.write('NEWS_REPORT_LOCK_READY\n'));
  return child;
}
test('flock invocation is fixed, isolated from credentials, and released by stdin closing', async t => {
  const directory = await fixture(t); const child = fakeHolder(); let invocation;
  const release = await acquireReportLock(directory, { spawnImpl: (...args) => { invocation = args; child.start(); return child; } });
  assert.equal(invocation[0], '/usr/bin/flock');
  assert.deepEqual(invocation[1].slice(0, 5), ['--exclusive', '--nonblock', '--conflict-exit-code', '73', path.join(directory, 'worker.lock')]);
  assert.equal(invocation[2].shell, false); assert.equal(invocation[2].detached, true);
  assert.deepEqual(Object.keys(invocation[2].env).sort(), ['LANG', 'PATH']);
  await release(); assert.equal(release.signal.aborted, false);
});
test('a held kernel lock rejects the second worker', async t => {
  const directory = await fixture(t); const child = fakeHolder({ conflict: true });
  await assert.rejects(acquireReportLock(directory, { spawnImpl: () => { child.start(); return child; } }), { code: 'REPORT_WORKER_LOCKED' });
});
test('unexpected lock-holder exit immediately aborts work even before stdio closes', async t => {
  const directory = await fixture(t); const child = fakeHolder();
  const release = await acquireReportLock(directory, { spawnImpl: () => { child.start(); return child; } });
  child.emit('exit', null, 'SIGKILL');
  assert.equal(release.signal.aborted, true); assert.equal(child.stdin.destroyed, true);
  child.emit('close', null, 'SIGKILL'); await release();
});
test('missing flock reports an explicit startup failure', async t => {
  const directory = await fixture(t); const child = fakeHolder();
  await assert.rejects(acquireReportLock(directory, { spawnImpl: () => {
    queueMicrotask(() => child.emit('error', Object.assign(new Error(), { code: 'ENOENT' }))); return child;
  } }), { code: 'REPORT_WORKER_LOCK_UNAVAILABLE' });
});
test('real Linux flock excludes competitors and ignores obsolete empty owner files', { skip: process.platform !== 'linux' }, async t => {
  const directory = await fixture(t); await mkdir(path.join(directory, 'worker-lock'));
  await writeFile(path.join(directory, 'worker-lock', 'owner.json'), '');
  await writeFile(path.join(directory, 'worker-lock', 'recovery.lock'), '');
  const release = await acquireReportLock(directory);
  await assert.rejects(acquireReportLock(directory), { code: 'REPORT_WORKER_LOCKED' });
  await release(); const second = await acquireReportLock(directory); await second();
});
test('real Linux flock is released after the worker receives SIGKILL', { skip: process.platform !== 'linux' }, async t => {
  const directory = await fixture(t, 'report-killed-lock-');
  const moduleUrl = new URL('./worker.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import { acquireReportLock } from ${JSON.stringify(moduleUrl)}; await acquireReportLock(${JSON.stringify(directory)}); console.log('ready');`],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', code => reject(new Error(`child exited ${code}`)));
    child.stdout.once('data', bytes => bytes.toString().trim() === 'ready' ? resolve() : reject(new Error('unexpected output')));
  });
  await assert.rejects(acquireReportLock(directory), { code: 'REPORT_WORKER_LOCKED' });
  const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exited;
  let release;
  // The child observing EOF is asynchronous; bound the handoff without touching any lock files.
  for (let attempt = 0; attempt < 30 && !release; attempt++) {
    try { release = await acquireReportLock(directory); }
    catch (error) { if (error.code !== 'REPORT_WORKER_LOCKED') throw error; await new Promise(resolve => setTimeout(resolve, 30)); }
  }
  assert.ok(release, 'kernel lock must release after parent pipe closes'); await release();
});
test('report queue is serial and cancellation does not start the next report', async () => {
  const controller = new AbortController(); const processed = [];
  await processReportQueue({ directory: '/unused', signal: controller.signal, listIdle: async () => [], list: async () => [{ id: 'first' }, { id: 'second' }],
    process: async id => { processed.push(id); controller.abort(); return { status: 'processing' }; } });
  assert.deepEqual(processed, ['first']);
});

test('worker automatically narrates new reports and migrates legacy idle reports once', async t => {
  const directory = await fixture(t, 'report-automatic-narration-');
  const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(160)]);
  for (const [index, status] of ['idle', 'queued', 'completed', 'partial', 'failed'].entries()) {
    const id = index.toString(16).padStart(64, '0');
    const report = await createReport({ id, notification: { content: `原文 ${index}` }, reportDate: '2026-11-12',
      createdAt: `2026-11-12T00:00:0${index}.000Z` }, { directory });
    if (status === 'idle') await writeReport({ ...report, status, audio: { status: 'not_requested', url: null, text: null } }, { directory });
    else if (status !== 'queued') await writeReport({ ...report, status, audio: { status: 'failed', url: null, text: null } }, { directory });
  }
  const spoken = [];
  const process = (id, options) => processNarration(id, { ...options,
    speak: async text => { spoken.push(text); return mp3; } });
  await processReportQueue({ directory, process });
  assert.deepEqual(spoken, ['原文 0', '原文 1']);
  for (const index of [0, 1]) {
    const report = await readReport(index.toString(16).padStart(64, '0'), { directory });
    assert.equal(report.status, 'completed'); assert.equal(report.audio.status, 'ready');
    assert.equal(report.audio.text, `原文 ${index}`); assert.equal(report.narration.attempts, 1);
  }
  assert.deepEqual(await listIdleReports({ directory }), []);
  assert.deepEqual(await listPendingReports({ directory }), []);
  await processReportQueue({ directory, process });
  assert.deepEqual(spoken, ['原文 0', '原文 1']);
  assert.equal((await readReport('4'.padStart(64, '0'), { directory })).status, 'failed');
});

test('a crash after legacy migration leaves a durable queue recovered without a page request', async t => {
  const directory = await fixture(t, 'report-migration-recovery-'); const id = 'a'.repeat(64);
  const report = await createReport({ id, notification: { content: '恢复原文' }, reportDate: '2026-11-12' }, { directory });
  await writeReport({ ...report, status: 'idle', audio: { status: 'not_requested', url: null, text: null } }, { directory });
  await assert.rejects(processReportQueue({ directory, queueAudio: async (...args) => {
    await queueReportAudio(...args); throw new Error('interrupted after durable migration');
  }, process: async () => assert.fail('migration interrupted before processing') }), /interrupted/);
  assert.equal((await readReport(id, { directory })).status, 'queued');
  let calls = 0;
  await processReportQueue({ directory, process: (id, options) => processNarration(id, { ...options,
    speak: async () => { calls++; return Buffer.concat([Buffer.from('ID3'), Buffer.alloc(160)]); } }) });
  assert.equal(calls, 1); assert.equal((await readReport(id, { directory })).status, 'completed');
});

test('cancellation before migration leaves historical idle reports untouched', async () => {
  const controller = new AbortController(); controller.abort();
  await processReportQueue({ signal: controller.signal, listIdle: async () => assert.fail('worker already stopped'),
    queueAudio: async () => assert.fail('worker already stopped'), list: async () => assert.fail('worker already stopped') });
});
