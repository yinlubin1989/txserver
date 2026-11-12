import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createReport, writeReport, saveAudio } from '../../../../../lib/newsReports/storage.mjs';
import { audioResponse } from './handler.mjs';

const id = 'c'.repeat(64);
const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(197, 5)]);
async function fixture(t, ready = true) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'news-audio-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const report = await createReport({ id, notification: { title: '日报', content: '测试原文' }, reportDate: '2026-11-12' }, { directory });
  await saveAudio(id, mp3, { directory });
  if (ready) await writeReport({ ...report, audio: { status: 'ready', url: `/api/news/${id}/audio` } }, { directory });
  return { directory };
}
function request(method = 'GET', range) {
  return new Request(`https://yinlubin.cn/api/news/${id}/audio`, { method, headers: range === undefined ? {} : { Range: range } });
}

test('GET and HEAD expose only published audio with correct headers', async t => {
  const options = await fixture(t);
  const get = await audioResponse(request(), id, options);
  assert.equal(get.status, 200); assert.equal(get.headers.get('content-type'), 'audio/mpeg');
  assert.equal(get.headers.get('accept-ranges'), 'bytes'); assert.equal(get.headers.get('content-length'), '200');
  assert.deepEqual(Buffer.from(await get.arrayBuffer()), mp3);
  const head = await audioResponse(request('HEAD', 'bytes=0-9'), id, options);
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), '200'); assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test('single bounded, open-ended, suffix and clamped ranges support seeking', async t => {
  const options = await fixture(t);
  for (const [range, start, end] of [['bytes=0-9', 0, 9], ['bytes=195-', 195, 199], ['bytes=-7', 193, 199], ['bytes=195-500', 195, 199], ['bytes=-500', 0, 199]]) {
    const response = await audioResponse(request('GET', range), id, options);
    assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/200`);
    assert.equal(response.headers.get('content-length'), String(end - start + 1));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp3.subarray(start, end + 1));
  }
});

test('invalid, unsatisfiable and multipart ranges return 416 rather than wrong bytes', async t => {
  const options = await fixture(t);
  for (const range of ['bytes=200-', 'bytes=8-3', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'bytes=9007199254740999-', 'items=1-3']) {
    const response = await audioResponse(request('GET', range), id, options);
    assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), 'bytes */200');
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
});

test('a file without ready status stays inaccessible; unknown IDs do not leak paths', async t => {
  const options = await fixture(t, false);
  assert.equal((await audioResponse(request(), id, options)).status, 404);
  const missing = await audioResponse(request(), 'd'.repeat(64), options);
  assert.equal(missing.status, 404); assert.equal((await missing.json()).code, 'NEWS_REPORT_NOT_FOUND');
  const traversal = await audioResponse(request(), '../credentials', options);
  assert.equal(traversal.status, 400); assert.ok(!(await traversal.text()).includes(options.directory));
});

test('missing ready audio is a storage failure, never an empty successful stream', async t => {
  const options = await fixture(t);
  await unlink(path.join(options.directory, 'audio', `${id}.mp3`));
  const response = await audioResponse(request(), id, options);
  assert.equal(response.status, 503); assert.equal((await response.json()).code, 'NEWS_AUDIO_MISSING');
});
