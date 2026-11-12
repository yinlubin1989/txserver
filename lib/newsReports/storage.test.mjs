import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createReport, readReport, writeReport, listReports, listPendingReports, publicReport,
  reportReference, saveAudio, readSavedAudio } from './storage.mjs';

const id = 'a'.repeat(64);
const notification = { title: '【grokbot】每日新闻', content: '今天的原始日报。', time: '2026-11-12 08:00' };
const createdAt = '2026-11-12T00:00:00.000Z';
const parameters = { id, notification, reportDate: '2026-11-12', createdAt };
const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200)]);
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'news-storage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory };
}

test('placeholder is persistent and includes the original before any enrichment', async t => {
  const options = await fixture(t);
  const report = await createReport(parameters, options);
  assert.equal(report.status, 'queued'); assert.equal(report.audio.status, 'pending');
  assert.equal(report.title, '每日新闻'); assert.equal(report.original.content, notification.content);
  assert.deepEqual(await readReport(id, options), report);
  assert.equal(await readReport('b'.repeat(64), options), null);
  assert.match(reportReference(report).url, new RegExp(`/news/${id}$`));
});

test('concurrent create is atomic and idempotent, and does not reset worker progress', async t => {
  const options = await fixture(t);
  const results = await Promise.all(Array.from({ length: 12 }, () => createReport(parameters, options)));
  assert.ok(results.every(report => report.id === id));
  const report = { ...results[0], status: 'processing', work: { searches: 3 } };
  await writeReport(report, options);
  assert.deepEqual(await createReport({ ...parameters, createdAt: '2026-11-12T02:00:00.000Z' }, options), report);
  assert.deepEqual(await readdir(path.join(options.directory, 'reports')), [`${id}.json`]);
});

test('same id with a different report is rejected instead of overwritten', async t => {
  const options = await fixture(t);
  await createReport(parameters, options);
  await assert.rejects(createReport({ ...parameters, notification: { ...notification, content: 'other' } }, options), { code: 'NEWS_REPORT_CONFLICT' });
  assert.equal((await readReport(id, options)).original.content, notification.content);
});

test('public projection removes private evidence at every nested level', async t => {
  const options = await fixture(t);
  const report = await createReport(parameters, options);
  Object.assign(report, {
    work: { evidence: 'private raw article' }, token: 'private',
    original: { ...report.original, secret: 'private' },
    sources: [{ id: 'source-1', title: '原始来源', url: 'https://example.com/article', siteName: 'Example', publishedAt: null, content: 'private raw article' }],
    body: { intro: '导语', voiceScript: '播报摘要', secret: 'private', highlights: [{ text: '重点', sourceIds: ['source-1'], private: 'raw' }],
      sections: [{ title: '事件', private: 'raw', paragraphs: [{ text: '事实', sourceIds: ['source-1'], kind: 'fact', raw: 'private' }] }] },
    warnings: [{ code: 'NEWS_TEST', message: '说明', detail: 'private' }],
    audio: { status: 'pending', url: null, localPath: '/secret' },
  });
  const visible = publicReport(report);
  assert.ok(!JSON.stringify(visible).includes('private'));
  assert.ok(!JSON.stringify(visible).includes('/secret'));
  visible.body.highlights[0].sourceIds.push('mutated');
  assert.equal(report.body.highlights[0].sourceIds.length, 1);
});

test('list has deterministic date ordering and exactly twenty entries per page', async t => {
  const options = await fixture(t);
  for (let index = 0; index < 22; index++) {
    await createReport({ ...parameters, id: index.toString(16).padStart(64, '0'),
      reportDate: index === 0 ? '2026-11-13' : '2026-11-12',
      createdAt: new Date(Date.parse(createdAt) + index * 1000).toISOString() }, options);
  }
  const first = await listReports(options), second = await listReports({ ...options, page: 2 });
  assert.equal(first.items.length, 20); assert.equal(first.hasMore, true); assert.equal(first.items[0].reportDate, '2026-11-13');
  assert.equal(second.items.length, 2); assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items].map(report => report.id)).size, 22);
  assert.equal(first.items[0].excerpt, notification.content);
  assert.ok(!Object.hasOwn(first.items[0], 'original'));
  await assert.rejects(listReports({ ...options, page: 0 }), { code: 'NEWS_PAGE_INVALID' });
});

test('pending queue ignores terminal reports and uses first-in order', async t => {
  const options = await fixture(t);
  const report = await createReport(parameters, options);
  await writeReport({ ...report, status: 'partial' }, options);
  await createReport({ ...parameters, id: 'b'.repeat(64), createdAt: '2026-11-11T00:00:00.000Z' }, options);
  const pending = await listPendingReports(options);
  assert.equal(pending.length, 1); assert.equal(pending[0].id, 'b'.repeat(64));
});

test('invalid dates, path traversal and corrupt manifests surface errors', async t => {
  const options = await fixture(t);
  await assert.rejects(createReport({ ...parameters, reportDate: '2026-02-30' }, options), { code: 'NEWS_REPORT_INVALID' });
  await assert.rejects(readReport('../credentials', options), { code: 'NEWS_REPORT_ID_INVALID' });
  await createReport(parameters, options);
  await writeFile(path.join(options.directory, 'reports', `${id}.json`), '{broken');
  await assert.rejects(readReport(id, options), { code: 'NEWS_REPORT_INVALID' });
  await assert.rejects(listReports(options), { code: 'NEWS_REPORT_INVALID' });
});

test('unknown states, unsafe source links and unresolved citations are not accepted', async t => {
  const options = await fixture(t);
  const report = await createReport(parameters, options);
  assert.throws(() => publicReport({ ...report, status: 'maybe_completed' }), { code: 'NEWS_REPORT_INVALID' });
  assert.throws(() => publicReport({ ...report, sources: [{ id: 'x', title: 'x', url: 'javascript:alert(1)', siteName: null, publishedAt: null }] }), { code: 'NEWS_REPORT_INVALID' });
  assert.throws(() => publicReport({ ...report, body: { intro: '', voiceScript: '', highlights: [{ text: 'x', sourceIds: ['missing'] }], sections: [] } }), { code: 'NEWS_REPORT_INVALID' });
});

test('saved audio is recoverable without publishing ready state', async t => {
  const options = await fixture(t);
  await createReport(parameters, options);
  assert.equal(await readSavedAudio(id, options), null);
  const url = await saveAudio(id, mp3, options);
  assert.equal(url, `/api/news/${id}/audio`);
  assert.deepEqual(await readSavedAudio(id, options), mp3);
  assert.equal((await readReport(id, options)).audio.status, 'pending');
  await assert.rejects(saveAudio(id, Buffer.from('not mp3'), options), { code: 'NEWS_AUDIO_INVALID' });
});
