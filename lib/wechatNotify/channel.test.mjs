import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteJson, readCredentials, readContext } from './channel.mjs';
import { acquireListenerLock, applyUpdates, runListener } from './listener.mjs';
import { WechatTransportError } from './transport.mjs';

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wechat-channel-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const empty = { recipient: 'owner', contextToken: '', cursor: '', updatedAt: null };
test('new channel is unbound, credentials are required, and files use private modes', async t => {
  const directory = await temporary(t);
  assert.equal((await readContext(directory)).contextToken, '');
  await assert.rejects(readCredentials(directory), { code: 'CHANNEL_NOT_CONFIGURED' });
  await atomicWriteJson(directory, 'credentials.json', { botToken: 'token', recipient: 'owner', ignored: 'value' });
  assert.deepEqual(await readCredentials(directory), { botToken: 'token', recipient: 'owner' });
  assert.equal((await stat(path.join(directory, 'credentials.json'))).mode & 0o777, 0o600);
  await assert.rejects(atomicWriteJson(directory, '../outside.json', {}), { code: 'CHANNEL_CONFIG_INVALID' });
});

test('malformed state does not silently become an empty channel', async t => {
  const directory = await temporary(t);
  await writeFile(path.join(directory, 'context.json'), '{bad');
  await assert.rejects(readContext(directory), { code: 'CHANNEL_CONFIG_INVALID' });
  await atomicWriteJson(directory, 'context.json', { recipient: 'owner', contextToken: 'x' });
  await assert.rejects(readContext(directory), { code: 'CHANNEL_CONFIG_INVALID' });
});

test('inbound updates retain only allowlisted peer context and no message content', () => {
  const state = applyUpdates(empty, 'owner', { ret: 0, get_updates_buf: 'cursor-2', msgs: [
    { from_user_id: 'stranger', message_type: 1, context_token: 'foreign', item_list: [{ text: 'private content' }] },
    { from_user_id: 'owner', message_type: 2, context_token: 'outgoing' },
    { from_user_id: 'owner', message_type: 1, context_token: 'new', item_list: [{ text: 'do not persist' }] },
  ] }, '2026-11-12T10:00:00.000Z');
  assert.deepEqual(state, { recipient: 'owner', contextToken: 'new', cursor: 'cursor-2', updatedAt: '2026-11-12T10:00:00.000Z' });
  assert.deepEqual(empty, { recipient: 'owner', contextToken: '', cursor: '', updatedAt: null });
  assert.equal(applyUpdates(state, 'owner', { ret: 0, msgs: [], get_updates_buf: '' }).cursor, 'cursor-2');
  assert.equal(applyUpdates(state, 'different', { ret: 0, msgs: [], get_updates_buf: 'other' }).contextToken, '');
});

test('poll responses must satisfy contract before any state advances', () => {
  for (const data of [{ msgs: [] }, { ret: 0, msgs: [] }, { ret: 0, get_updates_buf: 'x' },
    { ret: 0, msgs: [null], get_updates_buf: 'x' }, { ret: 0, errcode: -2, msgs: [], get_updates_buf: 'x' }]) {
    assert.throws(() => applyUpdates(empty, 'owner', data), { code: 'WECHAT_INVALID_RESPONSE' });
  }
  assert.equal(applyUpdates(empty, 'owner', { msgs: [], get_updates_buf: 'x', sync_buf: 'ignored' }).cursor, 'x');
});

test('listener lock prevents a second consumer and is released cleanly', async t => {
  const directory = await temporary(t);
  const release = await acquireListenerLock(directory);
  await assert.rejects(acquireListenerLock(directory), { code: 'LISTENER_LOCKED' });
  await release();
  const second = await acquireListenerLock(directory); await second();
});

test('listener persists context and health, not received text, and releases on stop', async t => {
  const directory = await temporary(t), controller = new AbortController();
  await atomicWriteJson(directory, 'credentials.json', { botToken: 'token', recipient: 'owner' });
  await runListener({ directory, signal: controller.signal,
    post: async () => ({ ret: 0, msgs: [{ from_user_id: 'owner', message_type: 1, context_token: 'ctx', text: 'secret message' }], get_updates_buf: 'next' }),
    wait: async () => controller.abort(),
  });
  const context = await readContext(directory);
  assert.equal(context.contextToken, 'ctx'); assert.equal(context.cursor, 'next');
  assert.ok(!(await readFile(path.join(directory, 'context.json'), 'utf8')).includes('secret message'));
  assert.equal(JSON.parse(await readFile(path.join(directory, 'health.json'), 'utf8')).status, 'connected');
  const release = await acquireListenerLock(directory); await release();
});

test('expired login backs off one hour without altering saved context', async t => {
  const directory = await temporary(t), controller = new AbortController();
  await atomicWriteJson(directory, 'credentials.json', { botToken: 'token', recipient: 'owner' });
  await atomicWriteJson(directory, 'context.json', empty);
  let waited;
  await runListener({ directory, signal: controller.signal,
    post: async () => { throw new WechatTransportError('WECHAT_LOGIN_REQUIRED', 'login', 409); },
    wait: async milliseconds => { waited = milliseconds; controller.abort(); },
  });
  assert.equal(waited, 3600000);
  assert.deepEqual(await readContext(directory), empty);
  assert.equal(JSON.parse(await readFile(path.join(directory, 'health.json'), 'utf8')).code, 'WECHAT_LOGIN_REQUIRED');
});
