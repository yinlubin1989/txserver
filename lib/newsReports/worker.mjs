import { mkdir, open, unlink, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getReportsDirectory, listPendingReports } from './storage.mjs';
import { processReport, researchErrorCode } from './research.mjs';
import { reportError } from './provider.mjs';

async function writeHealth(directory, value) {
  const temporary = path.join(directory, `.health.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path.join(directory, 'health.json'));
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

const LOCK_READY = 'NEWS_REPORT_LOCK_READY\n';
const HOLD_LOCK = `process.stdin.on('end', () => process.exit(0)); process.stdin.on('error', () => process.exit(1)); process.stdin.resume(); process.stdout.write(${JSON.stringify(LOCK_READY)});`;

/** flock owns the kernel lock; the tiny child holds it only while this worker's stdin pipe is open. */
export async function acquireReportLock(directory, { spawnImpl = spawn } = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lost = new AbortController(); let child, released = false, closed = false;
  try {
    child = spawnImpl('/usr/bin/flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '73',
      path.join(directory, 'worker.lock'), process.execPath, '--input-type=module', '-e', HOLD_LOCK], {
      shell: false, detached: true, stdio: ['pipe', 'pipe', 'ignore'], env: { PATH: process.env.PATH, LANG: 'C.UTF-8' },
    });
  } catch { throw reportError('REPORT_WORKER_LOCK_UNAVAILABLE'); }
  const killGroup = () => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  };
  const exit = new Promise(resolve => child.once('close', (code, signal) => {
    closed = true;
    if (!released) { lost.abort(reportError('REPORT_WORKER_LOCK_LOST')); child.stdin.destroy(); }
    resolve({ code, signal });
  }));
  child.once('exit', () => {
    if (!released) { lost.abort(reportError('REPORT_WORKER_LOCK_LOST')); child.stdin.destroy(); }
  });
  child.stdin.on('error', () => { if (!released) lost.abort(reportError('REPORT_WORKER_LOCK_LOST')); });
  try {
    await new Promise((resolve, reject) => {
      let ready = '';
      const timer = setTimeout(() => { killGroup(); reject(reportError('REPORT_WORKER_LOCK_UNAVAILABLE')); }, 5000);
      const finish = error => { clearTimeout(timer); if (error) reject(error); else resolve(); };
      child.once('error', () => finish(reportError('REPORT_WORKER_LOCK_UNAVAILABLE')));
      child.stdout.on('data', bytes => {
        ready += bytes.toString();
        if (ready === LOCK_READY) finish();
        else if (ready.length > LOCK_READY.length) { killGroup(); finish(reportError('REPORT_WORKER_LOCK_UNAVAILABLE')); }
      });
      exit.then(({ code }) => finish(reportError(code === 73 ? 'REPORT_WORKER_LOCKED' : 'REPORT_WORKER_LOCK_UNAVAILABLE')));
    });
  } catch (error) { released = true; child.stdin.destroy(); if (!closed) killGroup(); throw error; }
  if (lost.signal.aborted) throw reportError('REPORT_WORKER_LOCK_LOST');
  const release = async () => {
    if (released) return;
    released = true;
    child.stdin.end();
    if (!closed) {
      const timer = setTimeout(killGroup, 5000);
      try { await exit; } finally { clearTimeout(timer); }
    }
  };
  release.signal = lost.signal;
  return release;
}

export async function processReportQueue({ directory = getReportsDirectory(), signal,
  list = listPendingReports, process = processReport } = {}) {
  const reports = await list({ directory });
  for (const report of reports) {
    if (signal?.aborted) break;
    const startedAt = Date.now();
    const result = await process(report.id, { directory, signal });
    console.info('news-reports', { status: result?.status, elapsedMs: Date.now() - startedAt });
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
export async function runReportWorker({ directory = getReportsDirectory(), signal = new AbortController().signal } = {}) {
  const release = await acquireReportLock(directory);
  const workerSignal = AbortSignal.any([signal, release.signal]);
  const health = (status, code = null) => writeHealth(directory, { status, code, checkedAt: new Date().toISOString() });
  try {
    while (!workerSignal.aborted) {
      await health('processing');
      try { await processReportQueue({ directory, signal: workerSignal }); await health('idle'); }
      catch (error) { await health('error', researchErrorCode(error)); console.warn('news-reports', { code: researchErrorCode(error) }); }
      await pause(workerSignal);
    }
  } finally { try { await health('stopped'); } finally { await release(); } }
  if (release.signal.aborted) throw reportError('REPORT_WORKER_LOCK_LOST');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
  runReportWorker({ signal: controller.signal }).catch(error => {
    console.error('news-reports', { code: researchErrorCode(error) }); process.exitCode = 1;
  });
}
