import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReport, readReport, writeReport, listReports, listPendingReports, listIdleReports, queueReportAudio, publicReport,
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
async function createLegacyIdleReport(options) {
  const report = await createReport(parameters, options);
  return writeReport({ ...report, status: 'idle', audio: { status: 'not_requested', url: null, text: null } }, options);
}

test('creation atomically persists the original and its automatic narration queue', async t => {
  const options = await fixture(t);
  const report = await createReport(parameters, options);
  assert.equal(report.status, 'queued'); assert.equal(report.audio.status, 'pending');
  assert.equal(report.audio.text, null);
  assert.equal(report.title, notification.title); assert.equal(report.source, 'external');
  assert.equal(report.original.content, notification.content);
  assert.deepEqual(await readReport(id, options), report);
  assert.deepEqual(await listPendingReports(options), [report]);
  assert.deepEqual(await listIdleReports(options), []);
  await assert.rejects(readdir(path.join(options.directory, 'triggers')), { code: 'ENOENT' });
  assert.equal(await readReport('b'.repeat(64), options), null);
  assert.match(reportReference(report).url, new RegExp(`/news/${id}$`));
});

test('concurrent create is atomic and idempotent, and does not reset worker progress', async t => {
  const options = await fixture(t);
  const results = await Promise.all(Array.from({ length: 12 }, () => createReport(parameters, options)));
  assert.ok(results.every(report => report.id === id));
  const report = { ...results[0], status: 'processing', audio: { status: 'pending', url: null }, work: { searches: 3 } };
  await writeReport(report, options);
  assert.deepEqual(await createReport({ ...parameters, createdAt: '2026-11-12T02:00:00.000Z' }, options), report);
  assert.deepEqual(await readdir(path.join(options.directory, 'reports')), [`${id}.json`]);
});

test('same id with a different report is rejected instead of overwritten', async t => {
  const options = await fixture(t);
  await createReport(parameters, options);
  await assert.rejects(createReport({ ...parameters, notification: { ...notification, content: 'other' } }, options), { code: 'NEWS_REPORT_CONFLICT' });
  await assert.rejects(createReport({ ...parameters, notification: { ...notification, source: 'dot' } }, options), { code: 'NEWS_REPORT_CONFLICT' });
  assert.equal((await readReport(id, options)).original.content, notification.content);
});

test('sources are normalized metadata and titles retain every brand prefix', async t => {
  const options = await fixture(t);
  for (const [index, source] of ['DOT', 'muse', 'custom_BOT-1', 'GROKBOT', undefined].entries()) {
    const input = { ...notification, ...(source === undefined ? {} : { source }) };
    const report = await createReport({ ...parameters, id: index.toString(16).padStart(64, '0'), notification: input }, options);
    assert.equal(report.source, source?.toLowerCase() ?? 'external');
    assert.equal(report.title, notification.title); assert.equal(publicReport(report).source, report.source);
  }
  const list = await listReports(options);
  assert.deepEqual(new Set(list.items.map(report => report.source)), new Set(['dot', 'muse', 'custom_bot-1', 'grokbot', 'external']));
  for (const source of [null, 1, '', 'with space', '中文', 'a'.repeat(41)]) {
    await assert.rejects(createReport({ ...parameters, notification: { ...notification, source } }, options), { code: 'NEWS_REPORT_INVALID' });
  }
  const report = await createReport(parameters, options);
  for (const source of [undefined, null, '', 'DOT', 'bad source', 'a'.repeat(41)]) {
    assert.throws(() => publicReport({ ...report, source }), { code: 'NEWS_REPORT_INVALID' });
  }
});

test('legacy grokbot metadata is reused only for matching old inputs without rewriting progress', async t => {
  const options = await fixture(t);
  for (const [index, source] of [undefined, 'grokbot'].entries()) {
    const input = { ...parameters, id: index.toString(16).padStart(64, '0'),
      notification: { ...notification, ...(source === undefined ? {} : { source }) } };
    const report = await createReport(input, options);
    const legacy = { ...report, source: 'grokbot', title: '每日新闻', status: 'completed',
      audio: { status: 'ready', url: `/api/news/${report.id}/audio`, text: notification.content } };
    await writeReport(legacy, options);
    assert.deepEqual(await createReport(input, options), legacy);
    assert.deepEqual(await readReport(report.id, options), legacy);
    await assert.rejects(createReport({ ...input, notification: { ...input.notification, source: 'dot' } }, options), { code: 'NEWS_REPORT_CONFLICT' });
    await assert.rejects(createReport({ ...input, notification: { ...input.notification, title: '别的标题' } }, options), { code: 'NEWS_REPORT_CONFLICT' });
    await assert.rejects(createReport({ ...input, notification: { ...input.notification, content: '别的原文' } }, options), { code: 'NEWS_REPORT_CONFLICT' });
  }
});

test('public projection removes private evidence at every nested level', async t => {
  const options = await fixture(t);
  const report = await createReport(parameters, options);
  Object.assign(report, {
    status: 'processing', work: { evidence: 'private raw article' }, token: 'private',
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
  await writeReport({ ...report, status: 'partial', audio: { status: 'failed', url: null } }, options);
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

test('reading a newly queued report does not create a second task or change state', async t => {
  const options = await fixture(t);
  const report = await createReport(parameters, options);
  assert.equal(publicReport(await readReport(id, options)).status, 'queued');
  assert.equal((await listReports(options)).items[0].audioStatus, 'pending');
  assert.deepEqual(await listPendingReports(options), [report]);
  assert.deepEqual(await readReport(id, options), report);
  await assert.rejects(readdir(path.join(options.directory, 'triggers')), { code: 'ENOENT' });
});

test('parallel legacy migrations publish one durable trigger and never replace worker progress', async t => {
  const options = await fixture(t);
  await createLegacyIdleReport(options);
  assert.equal((await listIdleReports(options))[0].id, id);
  assert.deepEqual(await listPendingReports(options), []);
  const results = await Promise.all(Array.from({ length: 24 }, () => queueReportAudio(id, options)));
  assert.ok(results.every(report => report.status === 'queued' && report.audio.status === 'pending'));
  assert.deepEqual(await readdir(path.join(options.directory, 'triggers')), [`${id}.json`]);
  assert.equal((await listPendingReports(options)).length, 1);
  assert.deepEqual(await listIdleReports(options), []);
  const progress = { ...results[0], status: 'processing', work: { calls: { search: 4 }, stage: 'compose' } };
  await writeReport(progress, options);
  const cached = await Promise.all(Array.from({ length: 24 }, () => queueReportAudio(id, options)));
  assert.ok(cached.every(report => report.status === 'processing' && report.work.calls.search === 4));
  await assert.rejects(writeReport({ ...progress, status: 'idle', audio: { status: 'not_requested', url: null } }, options), { code: 'NEWS_REPORT_ALREADY_REQUESTED' });
});

test('published trigger is sufficient to recover after the triggering process exits', async t => {
  const options = await fixture(t);
  await createLegacyIdleReport(options);
  await queueReportAudio(id, options);
  // No process-local flag or second queue write is needed to discover this job.
  const { readFile } = await import('node:fs/promises');
  const original = JSON.parse(await readFile(path.join(options.directory, 'reports', `${id}.json`), 'utf8'));
  const trigger = JSON.parse(await readFile(path.join(options.directory, 'triggers', `${id}.json`), 'utf8'));
  assert.equal(original.status, 'idle'); assert.equal(trigger.status, 'queued');
  assert.equal((await readReport(id, options)).status, 'queued');
  assert.equal((await listPendingReports(options))[0].id, id);
});

test('separate processes share a single trigger and leave a recoverable queue', async t => {
  const options = await fixture(t);
  await createLegacyIdleReport(options);
  const script = `import { queueReportAudio } from ${JSON.stringify(new URL('./storage.mjs', import.meta.url).href)};
    await queueReportAudio(process.argv[1], { directory: process.argv[2] });`;
  const run = promisify(execFile);
  await Promise.all(Array.from({ length: 3 }, () => run(process.execPath, ['--input-type=module', '-e', script, id, options.directory])));
  assert.deepEqual(await readdir(path.join(options.directory, 'triggers')), [`${id}.json`]);
  assert.equal((await listPendingReports(options)).length, 1);
  assert.equal((await readReport(id, options)).status, 'queued');
});

test('terminal reports are shared cached results and cannot trigger again', async t => {
  const options = await fixture(t);
  const report = await createReport(parameters, options);
  for (const status of ['completed', 'partial', 'failed']) {
    await writeReport({ ...report, status, audio: { status: 'failed', url: null }, work: { calls: { search: 6 } } }, options);
    const cached = await queueReportAudio(id, options);
    assert.equal(cached.status, status); assert.equal(cached.work.calls.search, 6);
    assert.deepEqual(await createReport(parameters, options), cached);
    assert.deepEqual(await listIdleReports(options), []);
    assert.deepEqual(await listPendingReports(options), []);
  }
  await assert.rejects(readdir(path.join(options.directory, 'triggers')), { code: 'ENOENT' });
});

test('idle and not_requested are explicit consistent states', async t => {
  const options = await fixture(t);
  const report = await createLegacyIdleReport(options);
  assert.throws(() => publicReport({ ...report, audio: { status: 'pending', url: null } }), { code: 'NEWS_REPORT_INVALID' });
  assert.throws(() => publicReport({ ...report, status: 'queued' }), { code: 'NEWS_REPORT_INVALID' });
});

test('actual narration text is retained while legacy missing text stays null without changing state', async t => {
  const options = await fixture(t);
  await createReport(parameters, options);
  const queued = await queueReportAudio(id, options);
  assert.equal(queued.audio.text, null); assert.equal(queued.body, null);
  const report = { ...queued, status: 'processing', audio: { status: 'pending', url: null, text: '今天的原始日报。' } };
  await writeReport(report, options);
  assert.equal(publicReport(await readReport(id, options)).audio.text, '今天的原始日报。');
  const historical = { ...report, status: 'completed', audio: { status: 'ready', url: `/api/news/${id}/audio` } };
  assert.deepEqual(publicReport(historical).audio, { status: 'ready', url: `/api/news/${id}/audio`, text: null });
  assert.throws(() => publicReport({ ...report, audio: { ...report.audio, text: '字'.repeat(3001) } }), { code: 'NEWS_REPORT_INVALID' });
});

test('full original narration can exceed the previous two-megabyte cap but cannot exceed eight', async t => {
  const options = await fixture(t);
  const longer = Buffer.alloc(3 * 1024 * 1024);
  longer.write('ID3');
  await saveAudio(id, longer, options);
  assert.deepEqual(await readSavedAudio(id, options), longer);
  const oversized = Buffer.alloc(8 * 1024 * 1024 + 1);
  oversized.write('ID3');
  await assert.rejects(saveAudio(id, oversized, options), { code: 'NEWS_AUDIO_INVALID' });
});
