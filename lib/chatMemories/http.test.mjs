import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { loadModule } from '../financeStatistics/testLoader.mjs';

const { privateResponse, readQuestion } = loadModule('../chatMemories/http.ts');
const endpoint = 'https://example.test/api/chat-memories/ask';
const request = (payload, token = '') => new Request(endpoint, {
  method: 'POST', body: JSON.stringify(payload), headers: { Authorization: 'Bearer ' + token },
});

test('only the archive key grants access, and private replies cannot be cached', async (t) => {
  const key = 'a'.repeat(32);
  const previous = process.env.CHAT_MEMORIES_KEY_SHA256;
  process.env.CHAT_MEMORIES_KEY_SHA256 = createHash('sha256').update(key).digest('hex');
  t.after(() => {
    if (previous === undefined) delete process.env.CHAT_MEMORIES_KEY_SHA256;
    else process.env.CHAT_MEMORIES_KEY_SHA256 = previous;
  });
  let count = 0;
  const action = () => ({ count: ++count });
  for (const wrong of ['', 'b'.repeat(32)]) {
    const denied = await privateResponse(request({}, wrong), action);
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).code, 'UNAUTHORIZED');
    assert.match(denied.headers.get('cache-control'), /no-store/);
  }
  const allowed = await privateResponse(request({}, key), action);
  assert.deepEqual(await allowed.json(), { status: 'ok', count: 1 });
  assert.match(allowed.headers.get('cache-control'), /no-store/);
});

test('model consent is explicit and the input and body are bounded', async () => {
  for (const consent of [undefined, false, 'true']) {
    await assert.rejects(readQuestion(request({ question: '示例问题', allowModel: consent })), { code: 'CONSENT_REQUIRED' });
  }
  const ask = question => readQuestion(request({ question, allowModel: true }));
  assert.equal(await ask('  示例问题  '), '示例问题');
  assert.equal(await ask('😀'.repeat(400)), '😀'.repeat(400));
  for (const value of ['', '文'.repeat(401), 'x'.repeat(9000)]) {
    await assert.rejects(ask(value), { code: 'INVALID_INPUT' });
  }
});
