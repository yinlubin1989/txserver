import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import { createReport, queueReportAudio, readReport, writeReport, saveAudio } from './storage.mjs';
import { processNarration, narrationText } from './narration.mjs';
import { synthesizeNarrationSpeech } from './speech.mjs';

const id = 'c'.repeat(64);
const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(160, 1)]);
const original = '第一条：收入为 368 元，数量 10 束。\n第二条：未确认，不能作为既定事实。来源：https://example.org/a。';
async function fixture(t, { queued = true, content = original } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'report-narration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await createReport({ id, notification: { title: '原始简报', content, time: '' }, reportDate: '2026-11-12' }, { directory });
  if (queued) await queueReportAudio(id, { directory });
  return directory;
}
test('narration removes only links and preserves factual wording, numbers, and line breaks', () => {
  assert.equal(narrationText(original), '第一条：收入为 368 元，数量 10 束。\n第二条：未确认，不能作为既定事实。来源：。');
  assert.throws(() => narrationText('https://example.org/a'), { code: 'REPORT_NARRATION_EMPTY' });
  assert.throws(() => narrationText('https://example.org/a。 https://example.net/b！'), { code: 'REPORT_NARRATION_EMPTY' });
  assert.equal(narrationText('[来源](https://example.org/a)收入为368元。'), '[来源]()收入为368元。');
  assert.equal(narrationText('链接[https://example.org/a]数量10束。'), '链接[]数量10束。');
});
test('unrequested pages neither write state nor call TTS or AI', async t => {
  const directory = await fixture(t, { queued: false });
  const forbidden = async () => assert.fail('idle report must not run');
  const result = await processNarration(id, { directory, speak: forbidden, write: forbidden });
  assert.equal(result.status, 'idle'); assert.equal(result.audio.status, 'not_requested');
});
test('a queued report narrates its original without any HTTP model/search call', async t => {
  const directory = await fixture(t); const previousFetch = globalThis.fetch; let spoken;
  globalThis.fetch = async () => assert.fail('narration must not call a model or search endpoint');
  t.after(() => { globalThis.fetch = previousFetch; });
  const result = await processNarration(id, { directory, speak: async text => { spoken = text; return mp3; } });
  assert.equal(spoken, narrationText(original)); assert.equal(result.audio.text, spoken);
  assert.equal(result.original.content, original); assert.equal(result.body, null); assert.equal(result.status, 'completed');
  assert.equal(result.audio.status, 'ready'); assert.equal(result.narration.speechStatus, 'completed');
  assert.equal(result.narration.attempts, 1); assert.equal(result.work, undefined);
});
test('URL-only content fails explicitly without spending a TTS attempt', async t => {
  const directory = await fixture(t, { content: 'https://example.org' });
  const result = await processNarration(id, { directory, speak: async () => assert.fail('nothing to read') });
  assert.equal(result.status, 'failed'); assert.equal(result.narration.attempts, 0);
  assert.equal(result.warnings[0].code, 'REPORT_NARRATION_EMPTY');
});
test('an explicit TTS failure is terminal and never automatically retried', async t => {
  const directory = await fixture(t); let attempts = 0;
  const options = { directory, speak: async () => { attempts++; throw Object.assign(new Error(), { code: 'NEWS_TTS_TIMEOUT' }); } };
  const first = await processNarration(id, options); const second = await processNarration(id, options);
  assert.equal(first.status, 'failed'); assert.equal(second.audio.status, 'failed'); assert.equal(attempts, 1);
  assert.equal(second.original.content, original);
});
test('restart only retries interrupted synthesis and retains the absolute deadline', async t => {
  const directory = await fixture(t); const controller = new AbortController();
  await processNarration(id, { directory, now: () => 1000, signal: controller.signal,
    speak: async () => { controller.abort(); throw new Error('interrupted'); } });
  const pending = await readReport(id, { directory });
  assert.equal(pending.narration.speechStatus, 'generating'); assert.equal(pending.narration.attempts, 1);
  const result = await processNarration(id, { directory, now: () => 2000, speak: async () => mp3 });
  assert.equal(result.status, 'completed'); assert.equal(result.narration.attempts, 2); assert.equal(result.narration.deadlineAt, 121000);
});
test('the second interrupted attempt cannot spend a third attempt', async t => {
  const directory = await fixture(t);
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    await processNarration(id, { directory, signal: controller.signal,
      speak: async () => { controller.abort(); throw new Error(); } });
  }
  const result = await processNarration(id, { directory, speak: async () => assert.fail('attempt budget exhausted') });
  assert.equal(result.status, 'failed'); assert.equal(result.narration.attempts, 2);
  assert.equal(result.warnings[0].code, 'REPORT_NARRATION_ATTEMPTS_EXHAUSTED');
});
test('an old audio file cannot falsely complete a newly interrupted generation', async t => {
  const directory = await fixture(t); await saveAudio(id, Buffer.concat([Buffer.from('ID3'), Buffer.alloc(160, 2)]), { directory });
  const controller = new AbortController();
  await processNarration(id, { directory, signal: controller.signal,
    speak: async () => { controller.abort(); throw new Error(); } });
  let generated = false;
  const result = await processNarration(id, { directory, speak: async () => { generated = true; return mp3; } });
  assert.ok(generated); assert.equal(result.status, 'completed'); assert.equal(result.narration.attempts, 2);
});
test('a complete matching audio file survives a crash before ready without another TTS call', async t => {
  const directory = await fixture(t); const controller = new AbortController();
  await processNarration(id, { directory, signal: controller.signal, speak: async () => mp3,
    save: async (...args) => { await saveAudio(...args); controller.abort(); throw new Error('after save'); } });
  const pending = await readReport(id, { directory });
  assert.equal(pending.audio.status, 'pending'); assert.match(pending.narration.audioHash, /^[a-f0-9]{64}$/u);
  const result = await processNarration(id, { directory, speak: async () => assert.fail('matching audio is already durable') });
  assert.equal(result.status, 'completed'); assert.equal(result.narration.attempts, 1);
});
test('cancellation during reservation never starts synthesis', async t => {
  const directory = await fixture(t); const controller = new AbortController();
  const result = await processNarration(id, { directory, signal: controller.signal,
    write: async (report, options) => {
      await writeReport(report, options);
      if (report.narration.speechStatus === 'generating') controller.abort();
    }, speak: async () => assert.fail('worker no longer owns the active task') });
  assert.equal(result.status, 'processing'); assert.equal(result.narration.speechStatus, 'generating');
});
test('cancellation during audio persistence does not publish state after losing the lock', async t => {
  const directory = await fixture(t); const controller = new AbortController();
  const result = await processNarration(id, { directory, signal: controller.signal, speak: async () => mp3,
    save: async (...args) => { await saveAudio(...args); controller.abort(); } });
  assert.equal(result.status, 'processing'); assert.equal(result.audio.status, 'pending');
  const stored = await readReport(id, { directory }); assert.equal(stored.audio.status, 'pending');
  const recovered = await processNarration(id, { directory, speak: async () => assert.fail('audio is already durable') });
  assert.equal(recovered.status, 'completed'); assert.equal(recovered.narration.attempts, 1);
});
test('late TTS output is discarded and does not extend the total time budget', async t => {
  const directory = await fixture(t); let clock = 1000;
  const result = await processNarration(id, { directory, now: () => clock,
    speak: async () => { clock = 121001; return mp3; }, save: async () => assert.fail('late result') });
  assert.equal(result.status, 'failed'); assert.equal(result.warnings[0].code, 'REPORT_NARRATION_DEADLINE');
});
test('recovery rejects a changed narration script instead of reading unapproved text', async t => {
  const directory = await fixture(t); const controller = new AbortController();
  await processNarration(id, { directory, signal: controller.signal, speak: async () => { controller.abort(); throw new Error(); } });
  const pending = await readReport(id, { directory }); pending.audio.text = '被替换的稿件'; await writeReport(pending, { directory });
  const result = await processNarration(id, { directory, speak: async () => assert.fail('script does not match original') });
  assert.equal(result.status, 'failed'); assert.equal(result.warnings[0].code, 'REPORT_NARRATION_STATE_INVALID');
});
test('narration TTS accepts the full 3000-character bulletin and audio above the former 2MB cap', async () => {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.kill = () => {};
  let spoken = '';
  child.stdin.on('data', bytes => { spoken += bytes.toString(); });
  child.stdin.on('finish', () => {
    child.stdout.emit('data', Buffer.concat([Buffer.from('ID3'), Buffer.alloc(3 * 1024 * 1024)])); child.emit('close', 0);
  });
  const content = '简'.repeat(3000);
  const audio = await synthesizeNarrationSpeech(content, { binary: '/test/edge-tts', spawnImpl: () => child });
  assert.equal(spoken, content); assert.ok(audio.length > 2 * 1024 * 1024);
  await assert.rejects(synthesizeNarrationSpeech(`${content}报`, { binary: '/test/edge-tts', spawnImpl: () => assert.fail('oversized') }), { code: 'NEWS_SPEECH_INPUT_INVALID' });
});
