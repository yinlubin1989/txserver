import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { synthesizeNewsSpeech } from './speech.mjs';

function processMock(action) {
  return (binary, args, options) => {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough();
    child.kill = () => { queueMicrotask(() => child.emit('close', null)); return true; };
    let text = '';
    child.stdin.on('data', data => { text += data; });
    child.stdin.on('finish', () => action({ child, binary, args, options, text }));
    return child;
  };
}
test('speech uses stdin and no shell, keeps audio in memory and does not pass service secrets', async () => {
  const audio = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200)]);
  const buffer = await synthesizeNewsSpeech('新闻摘要。', { binary: '/fake/edge-tts', spawnImpl: processMock(({ child, args, options, text }) => {
    assert.equal(text, '新闻摘要。'); assert.ok(!args.includes(text)); assert.equal(options.shell, false);
    assert.equal(options.env.DEEPSEEK_API_KEY, undefined);
    child.stdout.write(audio); child.emit('close', 0);
  }) });
  assert.deepEqual(buffer, audio);
});
test('provider empty, oversized, failed and timeout outputs are errors, not silent speech', async () => {
  const scenarios = [
    { expected: 'NEWS_TTS_FAILED', action: ({ child }) => child.emit('close', 0) },
    { expected: 'NEWS_TTS_FAILED', action: ({ child }) => child.emit('close', 1) },
    { expected: 'NEWS_AUDIO_TOO_LARGE', action: ({ child }) => child.stdout.write(Buffer.alloc(2 * 1024 * 1024 + 1)) },
    { expected: 'NEWS_TTS_TIMEOUT', action: () => {} },
  ];
  for (const { expected, action } of scenarios) await assert.rejects(synthesizeNewsSpeech('摘要', {
    binary: '/fake/edge-tts', timeoutMs: 10, spawnImpl: processMock(action),
  }), { code: expected });
});
test('unconfigured and cancelled requests never launch speech', async () => {
  await assert.rejects(synthesizeNewsSpeech('摘要', { binary: '' }), { code: 'NEWS_TTS_NOT_CONFIGURED' });
  await assert.rejects(synthesizeNewsSpeech('字'.repeat(161)), { code: 'NEWS_SPEECH_INPUT_INVALID' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(synthesizeNewsSpeech('摘要', { binary: '/fake/edge-tts', signal: controller.signal }), { code: 'NEWS_CANCELLED' });
});

test('daily speech may explicitly allow 240 characters without changing the default limit', async () => {
  const audio = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200)]);
  const spawnImpl = processMock(({ child }) => { child.stdout.write(audio); child.emit('close', 0); });
  const options = { binary: '/fake/edge-tts', spawnImpl };
  await assert.rejects(synthesizeNewsSpeech('字'.repeat(200), options), { code: 'NEWS_SPEECH_INPUT_INVALID' });
  assert.deepEqual(await synthesizeNewsSpeech('字'.repeat(200), { ...options, maxCharacters: 240 }), audio);
  await assert.rejects(synthesizeNewsSpeech('摘要', { ...options, maxCharacters: 3201 }), { code: 'NEWS_SPEECH_INPUT_INVALID' });
  assert.deepEqual(await synthesizeNewsSpeech('字'.repeat(3000), { ...options, maxCharacters: 3000, maxBytes: 8 * 1024 * 1024 }), audio);
});
