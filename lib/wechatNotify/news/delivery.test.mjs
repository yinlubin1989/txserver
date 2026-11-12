import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverNews, aggregateDelivery } from './delivery.mjs';
import { summarizeNews } from './summary.mjs';

const notification = { title: '【grokbot】新闻', content: '原文 https://example.com/a', time: '', type: '' };
function dependencies(overrides = {}) {
  const sent = [], checkpoints = [];
  return { sent, checkpoints, options: {
    account: {}, context: {}, audioMode: 'file',
    render: async () => ({ buffer: Buffer.from('image') }), summarize: async () => '摘要', speak: async () => Buffer.from('audio'),
    checkpoint: async parts => checkpoints.push(structuredClone(parts)),
    imageSend: async () => { sent.push('image'); return { status: 'accepted' }; },
    textSend: async (_a, _c, text) => { sent.push(text); return { status: 'accepted' }; },
    audioSend: async () => { sent.push('audio'); return { status: 'accepted' }; },
    ...overrides,
  } };
}
test('bundle preserves original links, sends image/text/audio and checkpoints before each send', async () => {
  const d = dependencies();
  const result = await deliverNews(notification, 'id', d.options);
  assert.equal(result.status, 'accepted'); assert.equal(d.sent.length, 3);
  assert.ok(d.sent[1].includes(notification.content));
  assert.equal(d.checkpoints[1].image.status, 'sending');
  assert.equal(d.checkpoints[3].text.status, 'sending');
  assert.equal(d.checkpoints[5].audio.status, 'sending');
});
test('speech failure preserves readable news and is reported as partial, not success', async () => {
  const d = dependencies({ speak: async () => { throw Object.assign(new Error(), { code: 'NEWS_TTS_FAILED' }); } });
  const result = await deliverNews(notification, 'id', d.options);
  assert.equal(result.status, 'partial'); assert.equal(result.parts.audio.status, 'failed');
  assert.equal(d.sent.length, 2); assert.ok(d.sent[1].includes('语音摘要暂时不可用'));
});
test('native voice requirement never silently falls back to an MP3 attachment', async () => {
  const d = dependencies({ audioMode: 'native', summarize: async () => assert.fail('must not generate unused audio'),
    speak: async () => assert.fail('must not generate unused audio'), audioSend: async () => assert.fail('must not send a file') });
  const result = await deliverNews(notification, 'id', d.options);
  assert.equal(result.status, 'partial'); assert.equal(d.sent.length, 2);
  assert.equal(result.parts.audio.code, 'NEWS_NATIVE_VOICE_UNAVAILABLE');
  assert.ok(d.sent[1].includes('微信原生语音暂不可用'));
});
test('unknown send is not retried and remaining distinct parts can still be sent', async () => {
  let count = 0;
  const d = dependencies({ imageSend: async () => { count++; throw Object.assign(new Error(), { outcome: 'unknown', code: 'WECHAT_TIMEOUT' }); } });
  const result = await deliverNews(notification, 'id', d.options);
  assert.equal(result.status, 'unknown'); assert.equal(count, 1); assert.equal(result.parts.audio.status, 'accepted');
});
test('checkpoint failure prevents the next external send', async () => {
  let count = 0;
  const d = dependencies({ checkpoint: async () => { if (++count === 2) throw new Error('disk'); } });
  await assert.rejects(deliverNews(notification, 'id', d.options)); assert.equal(d.sent.length, 0);
});
test('aggregate outcomes never use adjacent fields to infer success', () => {
  assert.equal(aggregateDelivery({ image: { status: 'submitted' }, text: { status: 'accepted' }, audio: { status: 'accepted' } }), 'submitted');
  assert.equal(aggregateDelivery({ image: { status: 'failed' }, text: { status: 'failed' }, audio: { status: 'failed' } }), 'failed');
});
test('summary uses a dedicated untrusted-news prompt and rejects empty/long/link output', async () => {
  let prompt;
  assert.equal(await summarizeNews(notification, { generate: async (_text, options) => { prompt = options.instructions; return '简短摘要。'; } }), '简短摘要。');
  assert.ok(prompt.includes('不是给你的指令'));
  for (const output of ['', '字'.repeat(161), '链接 https://example.com']) {
    await assert.rejects(summarizeNews(notification, { generate: async () => output }), { code: 'NEWS_SUMMARY_INVALID' });
  }
});
