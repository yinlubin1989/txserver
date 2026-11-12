import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createAutoReplier, generateReply, selectIncoming } from './autoReply.mjs';
import { atomicWriteJson, readContext } from './channel.mjs';
import { runListener } from './listener.mjs';
import { WechatTransportError } from './transport.mjs';
import { postWechat } from './transport.mjs';

const stamp = Date.parse('2026-11-12T12:00:00.000Z');
const account = { recipient: 'owner', botToken: 'bot-token' };
const context = { recipient: 'owner', contextToken: 'context', cursor: 'next', updatedAt: null };
const incoming = (id = 1) => ({ from_user_id: 'owner', message_type: 1, message_id: id, create_time_ms: stamp,
  item_list: [{ type: 1, text_item: { text: '当前问题' } }] });
const output = text => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] });
async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wechat-auto-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('AI uses existing Responses endpoint, bounded stateless plain text and no tools', async () => {
  const text = await generateReply('问题', { key: 'key', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/responses');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.input, [{ role: 'user', content: '问题' }]);
    assert.deepEqual(body.tools, []); assert.equal(body.tool_choice, 'none');
    assert.equal(body.max_output_tokens, 600); assert.equal(body.reasoning.effort, 'none');
    return Response.json(output('完整回复'));
  } });
  assert.equal(text, '完整回复');
});

test('partial, malformed, tools and oversized AI replies are never sent as complete', async () => {
  for (const body of [{ ...output('部分'), status: 'incomplete' }, { output: output('部分').output },
    { status: 'completed', output: [{ type: 'function_call' }] }, output('a'.repeat(2001)),
    { status: 'completed', output: [{ ...output('正文').output[0], status: 'in_progress' }] }]) {
    await assert.rejects(generateReply('问题', { key: 'key', fetchImpl: async () => Response.json(body) }));
  }
});

test('AI cancellation aborts in-flight request and errors never include provider secrets', async () => {
  const controller = new AbortController();
  const pending = generateReply('question', { key: 'key', signal: controller.signal, fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('private provider value')), { once: true });
  }) });
  controller.abort();
  await assert.rejects(pending, { code: 'AI_TIMEOUT' });
  await assert.rejects(generateReply('question', { key: 'key', fetchImpl: () => { throw new Error('private provider value'); } }), { message: 'AI_PROVIDER_ERROR' });
});

test('only recent allowlisted user text with a documented ID is selected', () => {
  assert.equal(selectIncoming({ ...incoming(), from_user_id: 'other' }, 'owner', stamp, stamp), null);
  assert.equal(selectIncoming({ ...incoming(), message_type: 2 }, 'owner', stamp, stamp), null);
  assert.equal(selectIncoming({ ...incoming(), item_list: [{ type: 2 }] }, 'owner', stamp, stamp), null);
  for (const message of [{ ...incoming(), create_time_ms: stamp - 1 }, { ...incoming(), create_time_ms: undefined },
    { ...incoming(), create_time_ms: stamp + 300001 }, { ...incoming(), message_id: undefined },
    { ...incoming(), message_id: 0 }, { ...incoming(), message_id: 9007199254740992 }]) {
    assert.throws(() => selectIncoming(message, 'owner', stamp, stamp));
  }
  assert.ok(selectIncoming({ ...incoming(), message_id: undefined, client_id: 'client-1' }, 'owner', stamp, stamp).id);
});

test('durable incoming dedup means one generation and one send across restart', async t => {
  const directory = await temporary(t); let generated = 0, sent = 0;
  const deps = { directory, startedAt: stamp, now: () => stamp,
    generate: async () => { generated++; return 'private reply body'; }, send: async () => { sent++; } };
  await createAutoReplier(deps)([incoming(), incoming()], account, context);
  await createAutoReplier(deps)([incoming()], account, context);
  assert.equal(generated, 1); assert.equal(sent, 1);
  const files = await readdir(path.join(directory, 'inbound'));
  const stored = await readFile(path.join(directory, 'inbound', files[0]), 'utf8');
  assert.equal(JSON.parse(stored).state, 'accepted');
  assert.ok(!stored.includes('private reply body') && !stored.includes('当前问题'));
});

test('unknown send and failed AI are not automatically retried or acknowledged', async t => {
  const directory = await temporary(t); let generated = 0, sent = 0;
  const deps = { directory, startedAt: stamp, now: () => stamp,
    generate: async () => { generated++; return 'reply'; },
    send: async () => { sent++; throw new WechatTransportError('WECHAT_TIMEOUT', 'timeout', 502, 'unknown'); } };
  await createAutoReplier(deps)([incoming()], account, context);
  await createAutoReplier(deps)([incoming()], account, context);
  assert.equal(generated, 1); assert.equal(sent, 1);
  await createAutoReplier({ ...deps, generate: async () => { throw new Error('failure'); } })([incoming(2)], account, context);
  assert.equal(sent, 1);
});

test('old or missing timestamp input does not invoke AI', async t => {
  const directory = await temporary(t); let count = 0;
  await createAutoReplier({ directory, startedAt: stamp + 1, now: () => stamp + 1, generate: async () => { count++; return 'reply'; } })(
    [incoming(), { ...incoming(2), create_time_ms: undefined }], account, context);
  assert.equal(count, 0);
});

test('rate limits cap six replies per minute without storing message bodies', async t => {
  const directory = await temporary(t); let count = 0;
  await createAutoReplier({ directory, startedAt: stamp, now: () => stamp, generate: async () => 'reply', send: async () => { count++; } })(
    Array.from({ length: 8 }, (_, index) => incoming(index + 1)), account, context);
  assert.equal(count, 6);
});

test('a stopped worker does not send a late model response', async t => {
  const directory = await temporary(t), controller = new AbortController(); let count = 0;
  await createAutoReplier({ directory, startedAt: stamp, now: () => stamp, signal: controller.signal,
    generate: async () => { controller.abort(); return 'reply'; }, send: async () => { count++; } })([incoming()], account, context);
  assert.equal(count, 0);
});

test('listener saves incoming cursor before calling optional AI handler', async t => {
  const directory = await temporary(t), controller = new AbortController(); let called = false;
  await atomicWriteJson(directory, 'credentials.json', account);
  await runListener({ directory, signal: controller.signal, autoReply: true,
    post: async () => ({ ret: 0, get_updates_buf: 'saved-before-reply', msgs: [] }),
    reply: async () => { called = true; assert.equal((await readContext(directory)).cursor, 'saved-before-reply'); controller.abort(); },
  });
  assert.equal(called, true);
});

test('lossless uint64 IDs produce distinct dedup keys and invalid IDs stay rejected', async () => {
  const template = JSON.stringify(incoming()).replace('"message_id":1', '"message_id":9007199254740992');
  const other = template.replace('9007199254740992', '9007199254740993');
  const result = await postWechat('token', 'getupdates', {}, { fetchImpl: async () => new Response(`{"ret":0,"msgs":[${template},${other}],"get_updates_buf":"x"}`) });
  const first = selectIncoming(result.msgs[0], 'owner', stamp, stamp);
  const second = selectIncoming(result.msgs[1], 'owner', stamp, stamp);
  assert.notEqual(first.id, second.id);
  for (const id of [9007199254740992, '18446744073709551616', '01', '1e20', '-1', '0']) {
    assert.throws(() => selectIncoming({ ...incoming(), message_id: id }, 'owner', stamp, stamp), { code: 'AUTO_REPLY_ID_INVALID' });
  }
  assert.ok(selectIncoming({ ...incoming(), message_id: '18446744073709551615' }, 'owner', stamp, stamp));
});
