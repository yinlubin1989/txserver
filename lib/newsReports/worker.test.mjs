import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import { acquireReportLock, processReportQueue } from './worker.mjs';

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
  await processReportQueue({ directory: '/unused', signal: controller.signal, list: async () => [{ id: 'first' }, { id: 'second' }],
    process: async id => { processed.push(id); controller.abort(); return { status: 'processing' }; } });
  assert.deepEqual(processed, ['first']);
});
