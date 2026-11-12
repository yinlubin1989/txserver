import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createReport, queueReportDetails, readReport, writeReport, saveAudio, publicReport } from './storage.mjs';
import { processReport } from './research.mjs';

const id = 'b'.repeat(64);
const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(160)]);
const external = { title: '事件公告', url: 'https://example.org/news', summary: '摘要', content: '可核实正文',
  siteName: '来源', publishedAt: null, authority: 3, score: 2 };
async function fixture(t, { enqueue = true } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'daily-research-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await createReport({ id, notification: { title: '【grokbot】日报', content: '事件原文', time: '' },
    reportDate: '2026-11-12', createdAt: '2026-11-12T00:00:00.000Z' }, { directory });
  if (enqueue) await queueReportDetails(id, { directory });
  return directory;
}
const composed = { body: { intro: '本期事件概览', highlights: [{ text: '今日要点', sourceIds: ['report-original'] }],
  sections: [{ title: '事件背景', paragraphs: [{ text: '原文事实', sourceIds: ['report-original'], kind: 'fact' }] }],
  voiceScript: '今日要点摘要。' }, notes: [] };
function dependencies(directory, overrides = {}) {
  return { directory, plan: async () => ['事件'], search: async () => [external],
    fetch: async () => assert.fail('search already provided content'), compose: async () => structuredClone(composed),
    speak: async () => mp3, ...overrides };
}
test('idle reports do not research, generate audio, or change their state before an explicit request', async t => {
  const directory = await fixture(t, { enqueue: false });
  const forbidden = async () => assert.fail('an idle report must remain untouched');
  const report = await processReport(id, dependencies(directory, { plan: forbidden, search: forbidden,
    fetch: forbidden, compose: forbidden, speak: forbidden, write: forbidden }));
  assert.equal(report.status, 'idle'); assert.equal(report.audio.status, 'not_requested'); assert.equal(report.work, undefined);
});
test('research publishes text then audio and never exposes fetched evidence', async t => {
  const directory = await fixture(t); let textPublished = false;
  const report = await processReport(id, dependencies(directory, { speak: async () => {
    const stored = await readReport(id, { directory });
    textPublished = stored.body !== null && stored.audio.status === 'pending'; return mp3;
  } }));
  assert.ok(textPublished); assert.equal(report.status, 'completed'); assert.equal(report.audio.status, 'ready');
  assert.equal(report.work.calls.search, 1); assert.equal(report.work.calls.fetch, 0);
  assert.equal(report.work.calls.speech, 1); assert.deepEqual(report.work.evidence, []);
  assert.equal(publicReport(report).work, undefined);
  const resumed = await processReport(id, dependencies(directory, { plan: async () => assert.fail('completed reports never run again') }));
  assert.equal(resumed.status, 'completed');
});
test('empty search is explicit partial and retains the original', async t => {
  const directory = await fixture(t);
  const report = await processReport(id, dependencies(directory, { search: async () => [] }));
  assert.equal(report.status, 'partial'); assert.equal(report.original.content, '事件原文');
  assert.ok(report.warnings.some(item => item.code === 'REPORT_NO_EVIDENCE'));
});
test('unreadable source does not fabricate evidence', async t => {
  const directory = await fixture(t);
  const report = await processReport(id, dependencies(directory, { search: async () => [{ ...external, content: '' }],
    fetch: async () => { throw Object.assign(new Error(), { code: 'REPORT_FETCH_INVALID' }); } }));
  assert.equal(report.status, 'partial'); assert.equal(report.sources.length, 1);
  assert.ok(report.warnings.some(item => item.code === 'REPORT_FETCH_FAILED'));
});
test('composition error preserves original and does not generate audio', async t => {
  const directory = await fixture(t);
  const report = await processReport(id, dependencies(directory, { compose: async () => { throw Object.assign(new Error(), { code: 'REPORT_BODY_INVALID' }); },
    speak: async () => assert.fail('no validated script') }));
  assert.equal(report.status, 'failed'); assert.equal(report.body, null);
  assert.equal(report.audio.status, 'failed'); assert.equal(report.original.content, '事件原文');
});
test('speech failure keeps completed body readable', async t => {
  const directory = await fixture(t);
  const report = await processReport(id, dependencies(directory, { speak: async () => { throw Object.assign(new Error(), { code: 'NEWS_TTS_TIMEOUT' }); } }));
  assert.equal(report.status, 'partial'); assert.ok(report.body); assert.equal(report.audio.status, 'failed');
  assert.ok(report.warnings.some(item => item.code === 'REPORT_SPEECH_FAILED'));
});
test('interrupted search reservations survive restart and skip replay', async t => {
  const directory = await fixture(t); const controller = new AbortController(); let searchCalls = 0;
  await processReport(id, dependencies(directory, { signal: controller.signal, plan: async () => ['第一件', '第二件'],
    search: async () => { searchCalls++; controller.abort(); throw new Error('interrupted'); } }));
  const pending = await readReport(id, { directory });
  assert.equal(pending.status, 'processing'); assert.equal(pending.work.calls.search, 1); assert.equal(pending.work.searchIndex, 1);
  const result = await processReport(id, dependencies(directory, { plan: async () => assert.fail('plan is checkpointed'),
    search: async query => { searchCalls++; assert.equal(query, '第二件'); return [external]; } }));
  assert.equal(searchCalls, 2); assert.equal(result.work.calls.search, 2); assert.equal(result.status, 'partial');
});
test('deadline stays absolute after restart and does not spend more calls', async t => {
  const directory = await fixture(t); const controller = new AbortController();
  await processReport(id, dependencies(directory, { signal: controller.signal, now: () => 1000,
    search: async () => { controller.abort(); throw new Error(); } }));
  const result = await processReport(id, dependencies(directory, { now: () => 302000,
    search: async () => assert.fail('expired work cannot search') }));
  assert.equal(result.status, 'failed'); assert.equal(result.work.calls.search, 1);
  assert.ok(result.warnings.some(item => item.code === 'REPORT_DEADLINE'));
});
test('saved audio is recovered without another TTS call after a crash before ready', async t => {
  const directory = await fixture(t); const controller = new AbortController();
  await processReport(id, dependencies(directory, { signal: controller.signal, save: async (reportId, buffer, options) => {
    await saveAudio(reportId, buffer, options); controller.abort(); throw new Error('crash after audio write');
  } }));
  const pending = await readReport(id, { directory });
  assert.equal(pending.audio.status, 'pending'); assert.equal(pending.work.stage, 'speech');
  const result = await processReport(id, dependencies(directory, { speak: async () => assert.fail('must reuse complete file'),
    compose: async () => assert.fail('body already published') }));
  assert.equal(result.status, 'completed'); assert.equal(result.audio.status, 'ready'); assert.equal(result.work.calls.speech, 1);
});
test('already consumed budgets never reset during recovery', async t => {
  const directory = await fixture(t); const controller = new AbortController();
  await processReport(id, dependencies(directory, { signal: controller.signal,
    search: async () => { controller.abort(); throw new Error(); } }));
  const pending = await readReport(id, { directory });
  pending.work.calls.search = 6; pending.work.searchIndex = 0;
  await writeReport(pending, { directory });
  const result = await processReport(id, dependencies(directory, { search: async () => assert.fail('search budget exhausted') }));
  assert.equal(result.work.calls.search, 6); assert.equal(result.status, 'failed');
  assert.ok(result.warnings.some(item => item.code === 'REPORT_BUDGET_EXHAUSTED'));
});
test('a late successful composition cannot exceed the persisted deadline', async t => {
  const directory = await fixture(t); let clock = 1000;
  const result = await processReport(id, dependencies(directory, { now: () => clock,
    compose: async () => { clock = 301001; return structuredClone(composed); }, speak: async () => assert.fail('deadline expired') }));
  assert.equal(result.status, 'failed'); assert.equal(result.body, null); assert.equal(result.work.bodyStatus, 'pending');
  assert.ok(result.warnings.some(item => item.code === 'REPORT_DEADLINE'));
});
test('a late speech response cannot be saved or published after the deadline', async t => {
  const directory = await fixture(t); let clock = 1000;
  const result = await processReport(id, dependencies(directory, { now: () => clock,
    speak: async () => { clock = 301001; return mp3; }, save: async () => assert.fail('must discard late audio') }));
  assert.equal(result.status, 'partial'); assert.ok(result.body); assert.equal(result.audio.status, 'failed');
  assert.ok(result.warnings.some(item => item.code === 'REPORT_DEADLINE'));
});
test('recovery rejects a populated body inconsistent with its explicit checkpoint', async t => {
  const directory = await fixture(t); const controller = new AbortController();
  await processReport(id, dependencies(directory, { signal: controller.signal,
    search: async () => { controller.abort(); throw new Error(); } }));
  const pending = await readReport(id, { directory });
  pending.body = structuredClone(composed.body); // Partial/corrupt state must not infer a completed composition.
  await writeReport(pending, { directory });
  const result = await processReport(id, dependencies(directory, { compose: async () => assert.fail('invalid checkpoint'),
    speak: async () => assert.fail('must not infer valid script') }));
  assert.equal(result.status, 'failed'); assert.equal(result.audio.status, 'failed');
  assert.ok(result.warnings.some(item => item.code === 'REPORT_WORK_INVALID'));
});
