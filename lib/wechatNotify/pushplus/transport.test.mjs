import test from 'node:test';
import assert from 'node:assert/strict';
import { PushplusTransportError, sendPushplus, validatePushplusToken } from './transport.mjs';

const token = 'private-pushplus-token';
const input = { token, title: '测试日报', text: '完整原文\n\n完整日报与语音：https://example.com/news/test' };
const shortCode = '3cbc5eab19fe512e80677540fbde332a';
const accepted = () => Response.json({ code: 200, msg: '请求成功', data: shortCode });

test('send uses HTTPS, fixed wechat channel and txt template for the token owner only', async () => {
  const calls = [];
  const receipt = await sendPushplus(input, { fetchImpl: async (...args) => { calls.push(args); return accepted(); } });
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, 'https://www.pushplus.plus/send');
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(options.body), { token, title: input.title, content: input.text, template: 'txt', channel: 'wechat' });
  assert.deepEqual(receipt, { status: 'accepted', provider: 'pushplus', channel: 'wechat', providerMessageId: shortCode, deliveryStatus: 'pending' });
  assert.ok(!JSON.stringify(receipt).includes(token));
});

test('shortens only the Unicode title preview and preserves the complete original text', async () => {
  const title = '花🌸'.repeat(60);
  const text = `${title}\n完整原文`;
  await sendPushplus({ token, title, text }, { fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.title, '花🌸'.repeat(50));
    assert.equal(Array.from(body.title).length, 100);
    assert.equal(body.content, text);
    return accepted();
  } });
});

test('invalid local credentials or message fail before any network request', async () => {
  let calls = 0;
  const options = { fetchImpl: async () => { calls++; return accepted(); } };
  for (const value of [undefined, null, '', ' ', 'token\n', 'a'.repeat(513), 123]) {
    assert.throws(() => validatePushplusToken(value), error => error.code === 'PUSHPLUS_NOT_CONFIGURED' && error.outcome === 'failed');
    await assert.rejects(sendPushplus({ ...input, token: value }, options), { code: 'PUSHPLUS_NOT_CONFIGURED' });
  }
  for (const overrides of [{ text: '' }, { text: ' ' }, { text: 12 }, { title: 12 }, { text: '文'.repeat(20001) }]) {
    await assert.rejects(sendPushplus({ ...input, ...overrides }, options), { code: 'PUSHPLUS_INVALID_MESSAGE', outcome: 'failed' });
  }
  assert.equal(calls, 0);
});

test('explicit non-200 business codes are failed and never leak upstream text or retry', async () => {
  for (const [code, expectedCode, httpStatus] of [
    [900, 'PUSHPLUS_RATE_LIMITED', 429], [903, 'PUSHPLUS_TOKEN_INVALID', 503],
    [905, 'PUSHPLUS_VERIFICATION_REQUIRED', 503], [999, 'PUSHPLUS_REJECTED', 502],
    [500, 'PUSHPLUS_REJECTED', 502],
  ]) {
    let calls = 0;
    await assert.rejects(sendPushplus(input, { fetchImpl: async () => {
      calls++; return Response.json({ code, msg: token, data: shortCode });
    } }), error => {
      assert.ok(error instanceof PushplusTransportError);
      assert.equal(error.code, expectedCode);
      assert.equal(error.httpStatus, httpStatus);
      assert.equal(error.outcome, 'failed');
      assert.equal(error.upstreamCode, code);
      assert.ok(!error.message.includes(token));
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('missing or malformed business state cannot be inferred from a receipt or success message', async () => {
  for (const body of [null, [], {}, { data: shortCode }, { code: '200', data: shortCode },
    { code: 200 }, { code: 200, data: null }, { code: 200, data: '' }, { code: 200, data: ' ' },
    { code: 200, data: { shortCode } }, { code: 200, data: 'code\n' },
    { code: 200, data: 'a'.repeat(513) }, { msg: '请求成功', data: shortCode }]) {
    let calls = 0;
    await assert.rejects(sendPushplus(input, { fetchImpl: async () => { calls++; return Response.json(body); } }),
      { code: 'PUSHPLUS_INVALID_RESPONSE', outcome: 'unknown' });
    assert.equal(calls, 1);
  }
});

test('HTTP failures and non-JSON responses stay unknown without retry', async () => {
  for (const [response, expectedCode] of [
    [new Response('service failure', { status: 503 }), 'PUSHPLUS_HTTP_ERROR'],
    [new Response('', { status: 302, headers: { Location: 'https://example.com' } }), 'PUSHPLUS_HTTP_ERROR'],
    [new Response('not JSON'), 'PUSHPLUS_INVALID_RESPONSE'],
    [new Response(null, { status: 204 }), 'PUSHPLUS_INVALID_RESPONSE'],
  ]) {
    let calls = 0;
    await assert.rejects(sendPushplus(input, { fetchImpl: async () => { calls++; return response; } }),
      { code: expectedCode, outcome: 'unknown' });
    assert.equal(calls, 1);
  }
});

test('network errors hide transport details and do not retry', async () => {
  let calls = 0;
  await assert.rejects(sendPushplus(input, { fetchImpl: async () => { calls++; throw new Error(token); } }), error => {
    assert.equal(error.code, 'PUSHPLUS_NETWORK_ERROR');
    assert.equal(error.outcome, 'unknown');
    assert.ok(!error.message.includes(token));
    return true;
  });
  assert.equal(calls, 1);
});

test('timeout aborts one request and remains unknown', async () => {
  let calls = 0;
  await assert.rejects(sendPushplus(input, { timeoutMs: 5, fetchImpl: async (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } }), { code: 'PUSHPLUS_TIMEOUT', outcome: 'unknown' });
  assert.equal(calls, 1);
});

test('oversized provider responses are cancelled instead of accepted', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(sendPushplus(input, { fetchImpl: async () => response }),
    { code: 'PUSHPLUS_INVALID_RESPONSE', outcome: 'unknown' });
  assert.equal(cancelled, true);
});
