import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteJson } from '../channel.mjs';
import { processNewsQueue } from './worker.mjs';

const id = 'a'.repeat(64), file = `${id}.json`;
async function setup(t, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'news-worker-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const record = { state: 'queued', hash: 'hash', createdAt: new Date().toISOString(), notification: { content: 'private-news' },
    body: { status: 'queued', requestId: id, source: 'grokbot' }, ...overrides };
  await atomicWriteJson(path.join(directory, 'requests'), file, record);
  return { directory, read: async () => JSON.parse(await readFile(path.join(directory, 'requests', file), 'utf8')),
    options: { directory, credentials: async () => ({ recipient: 'owner' }), context: async () => ({ recipient: 'owner', contextToken: 'test' }) } };
}
test('queued job survives restart, runs once and erases source content on completion', async t => {
  const s = await setup(t); let count = 0;
  const deliver = async (_notification, _id, { checkpoint }) => {
    count++; await checkpoint({ text: { status: 'sending' } });
    return { status: 'accepted', parts: { text: { status: 'accepted' } } };
  };
  await processNewsQueue({ ...s.options, recover: true, deliver });
  await processNewsQueue({ ...s.options, recover: true, deliver });
  const record = await s.read();
  assert.equal(count, 1); assert.equal(record.body.status, 'accepted');
  assert.ok(!JSON.stringify(record).includes('private-news')); assert.equal(record.state, 'finished');
});
test('interrupted job becomes unknown without sending again', async t => {
  const s = await setup(t, { state: 'processing', body: { status: 'processing', parts: { image: { status: 'sending' } } } });
  await processNewsQueue({ ...s.options, recover: true, deliver: async () => assert.fail('must not resend') });
  const record = await s.read();
  assert.equal(record.body.status, 'unknown'); assert.equal(record.body.parts.image.status, 'unknown');
  assert.equal(record.notification, undefined);
});
test('expired or unbound job fails before any send', async t => {
  const s = await setup(t, { createdAt: '2020-01-01T00:00:00Z' });
  await processNewsQueue({ ...s.options, deliver: async () => assert.fail('must not send stale news') });
  assert.equal((await s.read()).body.code, 'NEWS_EXPIRED');
});
