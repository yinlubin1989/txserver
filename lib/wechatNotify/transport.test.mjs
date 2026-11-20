import test from 'node:test';
import assert from 'node:assert/strict';
import { postWechat, sendText } from './transport.mjs';

const success = () => Response.json({ ret: 0 });
test('text uses the fixed HTTPS endpoint, wire fields, and no redirect', async () => {
  let calls = 0;
  const receipt = await sendText({ botToken: 'private-token', recipient: 'owner' }, { recipient: 'owner', contextToken: 'context' }, '你好', 'request-1', {
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://ilinkai.weixin.qq.com/ilink/bot/sendmessage');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer private-token');
      assert.match(Buffer.from(options.headers['X-WECHAT-UIN'], 'base64').toString(), /^\d+$/);
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload.msg, { from_user_id: '', to_user_id: 'owner', client_id: 'request-1', message_type: 2,
        message_state: 2, context_token: 'context', item_list: [{ type: 1, text_item: { text: '你好' } }] });
      assert.equal(payload.base_info.channel_version, '3.0.1/txserver-1.0.0');
      return success();
    },
  });
  assert.deepEqual(receipt, { status: 'accepted' });
  assert.equal(calls, 1);
});

test('missing or mismatched peer context cannot send', async () => {
  for (const context of [{ recipient: 'other', contextToken: 'context' }, { recipient: 'owner', contextToken: '' }]) {
    await assert.rejects(sendText({ botToken: 'token', recipient: 'owner' }, context, 'text', 'id', {
      fetchImpl: () => { throw new Error('must not call'); },
    }), { code: 'CONTEXT_REQUIRED', outcome: 'failed' });
  }
});

test('send responses validate status fields and documented optional field types', async () => {
  for (const body of [{ ret: '0' }, { ret: null }, { ret: 0, errcode: '0' }, { errcode: null },
    { errmsg: null }, { errmsg: 0 }, { ret: 0, errmsg: false }, [], null]) {
    await assert.rejects(postWechat('token', 'sendmessage', {}, { fetchImpl: async () => Response.json(body) }),
      { code: 'WECHAT_INVALID_RESPONSE', outcome: 'unknown' });
  }
  assert.deepEqual(await postWechat('token', 'getconfig', {}, { fetchImpl: async () => Response.json({ ret: 0, errcode: 0 }) }), { ret: 0, errcode: 0 });
});

test('documented send responses without ret are submitted, never accepted or delivered', async () => {
  for (const body of [{}, { errmsg: '' }, { message_id: 17 }, { message_id: '18446744073709551615' },
    { message_id: '17', errmsg: '' }, { errcode: 0 }]) {
    let calls = 0;
    const receipt = await sendText({ botToken: 'token', recipient: 'owner' }, { recipient: 'owner', contextToken: 'context' }, 'text', 'id',
      { fetchImpl: async () => { calls++; return Response.json(body); } });
    assert.deepEqual(receipt, { status: 'submitted', deliveryStatus: 'unknown', acknowledgement: 'missing_business_status' });
    assert.equal(calls, 1);
  }
  await assert.rejects(postWechat('token', 'getconfig', {}, { fetchImpl: async () => Response.json({}) }), { code: 'WECHAT_INVALID_RESPONSE' });
  await assert.rejects(postWechat('token', 'getconfig', {}, { fetchImpl: async () => Response.json({ errcode: -14 }) }), { code: 'WECHAT_INVALID_RESPONSE' });
});

test('message IDs and unrecognized response objects cannot mask invalid send receipts', async () => {
  for (const message_id of [null, 0, -1, 1.5, '', '0', '01', '-1', '1.5', '18446744073709551616', 'secret', {}, []]) {
    for (const body of [{ message_id }, { ret: 0, message_id }]) {
      await assert.rejects(postWechat('token', 'sendmessage', {}, { fetchImpl: async () => Response.json(body) }),
        { code: 'WECHAT_INVALID_RESPONSE', outcome: 'unknown' });
    }
  }
  for (const body of [{ arbitrary: true }, { errmsg: 'upstream details' }, { message_id: 17, errmsg: 'upstream details' }]) {
    let calls = 0;
    await assert.rejects(postWechat('token', 'sendmessage', {}, { fetchImpl: async () => { calls++; return Response.json(body); } }), error => {
      assert.equal(error.code, 'WECHAT_INVALID_RESPONSE'); assert.equal(error.outcome, 'unknown');
      assert.ok(!error.message.includes('upstream details')); return true;
    });
    assert.equal(calls, 1);
  }
});

test('uint64 send receipt retains exact digits and ret zero remains explicit acceptance', async () => {
  const raw = '{"message_id":18446744073709551615}';
  const response = await postWechat('token', 'sendmessage', {}, { fetchImpl: async () => new Response(raw) });
  assert.equal(response.message_id, '18446744073709551615');
  const receipt = await sendText({ botToken: 'token', recipient: 'owner' }, { recipient: 'owner', contextToken: 'context' }, 'text', 'id',
    { fetchImpl: async () => Response.json({ ret: 0, message_id: '18446744073709551615', errmsg: '' }) });
  assert.deepEqual(receipt, { status: 'accepted' });
});

test('explicit rejections are failures; -2 is not guessed to mean expiry', async () => {
  for (const body of [{ ret: -2, errmsg: 'secret upstream body' }, { ret: 0, errcode: -2 }, { errcode: -2 },
    { ret: -2, message_id: 0, errmsg: null }]) {
    let calls = 0;
    await assert.rejects(postWechat('token', 'sendmessage', {}, { fetchImpl: async () => { calls++; return Response.json(body); } }), error => {
      assert.equal(error.code, 'WECHAT_REJECTED'); assert.equal(error.outcome, 'failed');
      assert.equal(error.upstreamErrcode ?? error.upstreamRet, -2);
      assert.match(error.message, /可能.*会话失效或上游限制/);
      assert.match(error.message, /先给微信机器人发一句消息更新会话/);
      assert.ok(!error.message.includes('secret')); return true;
    });
    assert.equal(calls, 1);
  }
  for (const body of [{ errcode: -14 }, { ret: -14 }, { ret: 0, errcode: -14 }, { errcode: -14, message_id: null, errmsg: null }]) {
    await assert.rejects(postWechat('token', 'sendmessage', {}, { fetchImpl: async () => Response.json(body) }),
      { code: 'WECHAT_LOGIN_REQUIRED', outcome: 'failed', httpStatus: 409 });
  }
  await assert.rejects(postWechat('token', 'getupdates', {}, { fetchImpl: async () => Response.json({ ret: -14 }) }),
    { code: 'WECHAT_LOGIN_REQUIRED', outcome: 'failed' });
});

test('HTTP/network/malformed/oversized send responses are unknown and never retried', async () => {
  const factories = [() => new Response('error', { status: 503 }), () => { throw new Error('token'); },
    () => new Response('invalid json'), () => new Response('a'.repeat(1024 * 1024 + 1))];
  for (const factory of factories) {
    let calls = 0;
    await assert.rejects(postWechat('token', 'sendmessage', {}, { fetchImpl: async () => { calls++; return factory(); } }),
      { outcome: 'unknown' });
    assert.equal(calls, 1);
  }
});

test('timeout and external cancellation interrupt requests', async () => {
  const fetchImpl = (_, { signal }) => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('aborted')); return; }
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  await assert.rejects(postWechat('token', 'sendmessage', {}, { fetchImpl, timeoutMs: 10 }),
    { code: 'WECHAT_TIMEOUT', outcome: 'unknown' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(postWechat('token', 'getupdates', {}, { fetchImpl, signal: controller.signal }),
    { code: 'WECHAT_TIMEOUT', outcome: 'failed' });
});

test('arbitrary endpoints and invalid credentials are rejected before fetch', async () => {
  await assert.rejects(postWechat('token', 'https://other.example', {}), { code: 'INVALID_ENDPOINT' });
  await assert.rejects(postWechat('token\nsecret', 'sendmessage', {}), { code: 'CHANNEL_NOT_CONFIGURED' });
});

test('uint64 incoming message IDs retain their exact wire digits', async () => {
  const raw = '{"ret":0,"msgs":[{"message_id":9007199254740992},{"message_id":9007199254740993},{"message_id":18446744073709551615},{"message_id":17}],"get_updates_buf":"cursor"}';
  const data = await postWechat('token', 'getupdates', {}, { fetchImpl: async () => new Response(raw) });
  assert.deepEqual(data.msgs.map(message => message.message_id), ['9007199254740992', '9007199254740993', '18446744073709551615', 17]);
});

test('getupdates permits omitted zero flags only with its complete endpoint payload', async () => {
  for (const body of [{ msgs: [], get_updates_buf: 'x' }, { ret: 0, msgs: [], get_updates_buf: '' },
    { errcode: 0, msgs: [], get_updates_buf: 'x', sync_buf: 'deprecated' }]) {
    assert.deepEqual(await postWechat('token', 'getupdates', {}, { fetchImpl: async () => Response.json(body) }), body);
  }
  for (const body of [{}, { msgs: [] }, { msgs: [], sync_buf: 'no-fallback' }, { get_updates_buf: 'x' },
    { msgs: [], get_updates_buf: 'x', ret: '0' }, { msgs: [], get_updates_buf: 'x', errcode: null }]) {
    await assert.rejects(postWechat('token', 'getupdates', {}, { fetchImpl: async () => Response.json(body) }),
      { code: 'WECHAT_INVALID_RESPONSE' });
  }
  await assert.rejects(postWechat('token', 'getupdates', {}, { fetchImpl: async () => Response.json({ ret: -2 }) }), { code: 'WECHAT_REJECTED' });
  await assert.rejects(postWechat('token', 'sendmessage', {}, { fetchImpl: async () => Response.json({ msgs: [], get_updates_buf: 'x' }) }),
    { code: 'WECHAT_INVALID_RESPONSE', outcome: 'unknown' });
});
