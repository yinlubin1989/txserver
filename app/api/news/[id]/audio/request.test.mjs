import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createReport, readReport, writeReport, listPendingReports } from '../../../../../lib/newsReports/storage.mjs';
import { requestAudioResponse } from './request.mjs';

const id = 'e'.repeat(64);
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'news-details-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await createReport({ id, notification: { title: '日报', content: '原文' }, reportDate: '2026-11-12' }, { directory });
  return { directory, expectedOrigin: 'https://yinlubin.cn' };
}
function request(headers = {}, body) {
  return new Request(`https://yinlubin.cn/api/news/${id}/audio`, { method: 'POST', headers, ...(body === undefined ? {} : { body }) });
}

test('only an explicit same-origin POST queues audio, duplicate clicks reuse shared result', async t => {
  const options = await fixture(t);
  assert.equal((await readReport(id, options)).status, 'idle');
  const responses = await Promise.all(Array.from({ length: 12 }, () => requestAudioResponse(request({ origin: 'https://yinlubin.cn', 'sec-fetch-site': 'same-origin' }), id, options)));
  for (const response of responses) {
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'completed'); assert.equal(body.report.status, 'queued'); assert.equal(body.report.audio.status, 'pending');
  }
  assert.equal((await listPendingReports(options)).length, 1);
  const report = await readReport(id, options);
  await writeReport({ ...report, status: 'failed', audio: { status: 'failed', url: null }, work: { attempts: 1 } }, options);
  const cached = await (await requestAudioResponse(request(), id, options)).json();
  assert.equal(cached.report.status, 'failed'); assert.equal(cached.report.work, undefined);
  assert.deepEqual(await listPendingReports(options), []);
});

test('cross-site, sibling-site and foreign origins are rejected without starting work', async t => {
  const options = await fixture(t);
  for (const headers of [{ origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' },
    { origin: 'null' }, { origin: 'https://yinlubin.cn', 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
    const response = await requestAudioResponse(request(headers), id, options);
    assert.equal(response.status, 403); assert.equal((await response.json()).code, 'NEWS_AUDIO_ORIGIN_REJECTED');
  }
  assert.equal((await readReport(id, options)).status, 'idle');
});

test('server calls without Origin are allowed but cannot upload replacement content', async t => {
  const options = await fixture(t);
  const rejected = await requestAudioResponse(request({}, JSON.stringify({ content: 'new article', url: 'https://other.example' })), id, options);
  assert.equal(rejected.status, 400); assert.equal((await readReport(id, options)).status, 'idle');
  assert.equal((await requestAudioResponse(request(), id, options)).status, 200);
});

test('Next-style empty body streams are accepted without treating them as uploaded content', async t => {
  const options = await fixture(t);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(0)); controller.close(); } });
  const input = new Request(`https://yinlubin.cn/api/news/${id}/audio`, {
    method: 'POST', headers: { origin: 'https://yinlubin.cn', 'sec-fetch-site': 'same-origin' }, body: stream, duplex: 'half',
  });
  assert.notEqual(input.body, null);
  const response = await requestAudioResponse(input, id, options);
  assert.equal(response.status, 200); assert.equal((await response.json()).report.status, 'queued');
});

test('an unfinished request body times out without queuing paid work', async t => {
  const options = await fixture(t);
  const input = new Request(`https://yinlubin.cn/api/news/${id}/audio`, {
    method: 'POST', body: new ReadableStream(), duplex: 'half',
  });
  const response = await requestAudioResponse(input, id, options);
  assert.equal(response.status, 408);
  assert.equal((await response.json()).code, 'NEWS_AUDIO_REQUEST_TIMEOUT');
  assert.equal((await readReport(id, options)).status, 'idle');
});

test('unknown reports cannot be created by the public trigger endpoint', async t => {
  const options = await fixture(t);
  const response = await requestAudioResponse(request(), 'f'.repeat(64), options);
  assert.equal(response.status, 404); assert.equal((await response.json()).code, 'NEWS_REPORT_NOT_FOUND');
  assert.equal(await readReport('f'.repeat(64), options), null);
});

test('loopback preview is allowed only in explicit development and with matching origin', async t => {
  const options = await fixture(t);
  const previous = process.env.NODE_ENV;
  t.after(() => { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; });
  const local = origin => new Request(`http://127.0.0.1:4015/api/news/${id}/audio`, {
    method: 'POST', headers: { origin, 'sec-fetch-site': 'same-origin' },
  });
  for (const environment of ['production', 'test', '']) {
    process.env.NODE_ENV = environment;
    assert.equal((await requestAudioResponse(local('http://127.0.0.1:4015'), id, options)).status, 403);
  }
  process.env.NODE_ENV = 'development';
  assert.equal((await requestAudioResponse(local('http://127.0.0.1:4016'), id, options)).status, 403);
  assert.equal((await requestAudioResponse(local('http://127.0.0.1:4015'), id, options)).status, 200);
});
