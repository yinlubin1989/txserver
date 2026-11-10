import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, loadModule, record, setup } from './testSupport.mjs';

test('creates an independent capability and persists only its hash after strict empty input', async () => {
  const { service, storage } = setup();
  for (const input of [null, [], { token: 'forged' }]) await assert.rejects(service.createSession(input), { code: 'INVALID_RECORD' });
  const { token } = await service.createSession({});
  assert.match(token, /^[a-f0-9]{64}$/); assert.equal(storage.sessions.has(token), false); assert.equal(storage.sessions.has(hash(token)), true);
  for (const invalid of [null, '', 'x'.repeat(64), '0'.repeat(64)]) await assert.rejects(service.listRecords(invalid, null), { code: 'UNAUTHORIZED' });
});

test('isolates owners even for matching record IDs and never exposes internal metadata', async () => {
  const { service } = setup(); const a = await service.createSession({}); const b = await service.createSession({});
  await service.saveRecords(a.token, { records: [record()] });
  assert.deepEqual(await service.listRecords(b.token, null), { records: [], nextCursor: null });
  await service.saveRecords(b.token, { records: [record(1, { text: '另一位虚构用户的数据' })] });
  const result = await service.listRecords(a.token, null);
  assert.equal(result.records[0].text, record().text);
  assert.deepEqual(Object.keys(result.records[0]).sort(), [...Object.keys(record()), 'archivedAt'].sort());
});

test('identical retries and concurrent inserts are idempotent without changing archival time', async () => {
  const { service, storage } = setup(); const { token } = await service.createSession({});
  const results = await Promise.all(Array.from({ length: 5 }, () => service.saveRecords(token, { records: [record()] })));
  assert.ok(results.every(result => result.acceptedIds[0] === record().id)); assert.equal(storage.records.size, 1);
  await assert.rejects(service.saveRecords(token, { records: [record(1, { text: 'different' })] }), error => error.code === 'IDEMPOTENCY_CONFLICT' && error.httpStatus === 409 && error.acceptedIds.length === 0);
  assert.equal((await service.listRecords(token, null)).records[0].text, record().text);
});

test('validates all records before writing, including fields, enums, dates and batch bounds', async () => {
  const { service, storage } = setup(); const { token } = await service.createSession({});
  const invalid = [
    { records: [] }, { records: Array.from({ length: 51 }, (_, i) => record(i + 1)) },
    { records: [record(), record()] }, { records: [record()], ownerHash: 'forged' },
    ...[{ token: 'forged' }, { text: null }, { text: 'x'.repeat(64001) }, { peerName: null }, { peerName: 'x'.repeat(257) }, { peerId: '' }, { profile: 'p\n' }, { occurredAt: '2026-11-10T00:00:00Z' }, { occurredAt: '2026-02-30T00:00:00.000Z' }, { conversationId: null }, { direction: 'outgoing' }, { source: { toString: () => 'incoming' } }, { status: 'sent' }].map(changes => ({ records: [record(2), record(1, changes)] })),
  ];
  for (const raw of invalid) await assert.rejects(service.saveRecords(token, raw), { code: 'INVALID_RECORD' });
  assert.equal(storage.insertCount, 0);
  await service.saveRecords(token, { records: [record(1, { direction: 'outgoing', source: 'outbound', conversationId: null, status: 'unknown' })] });
  await service.saveRecords(token, { records: [record(2, { peerName: '', text: '' }), record(3, { peerName: ' ', text: '  ' })] });
  const empty = (await service.listRecords(token, null)).records.find(item => item.id === record(2).id);
  assert.equal(empty.peerName, ''); assert.equal(empty.text, '');
});

test('returns only a durable prefix after failure and permits an unchanged retry', async () => {
  const { service, storage } = setup(); const { token } = await service.createSession({});
  storage.failAt = 2;
  await assert.rejects(service.saveRecords(token, { records: [record(1), record(2), record(3)] }), error => error.code === 'ARCHIVE_UNAVAILABLE' && JSON.stringify(error.acceptedIds) === JSON.stringify([record(1).id]));
  assert.equal(storage.records.size, 1); assert.equal(storage.insertCount, 2);
  storage.failAt = 0;
  assert.deepEqual(await service.saveRecords(token, { records: [record(1), record(2), record(3)] }), { acceptedIds: [record(1).id, record(2).id, record(3).id] });
  assert.equal(storage.records.size, 3);
  await assert.rejects(service.saveRecords(token, { records: [record(4), record(2, { text: 'conflict' }), record(5)] }), error => error.httpStatus === 409 && error.acceptedIds.length === 1 && error.acceptedIds[0] === record(4).id);
  assert.equal(storage.records.size, 4);
});

test('recovers from a database commit whose acknowledgement was lost', async () => {
  const { service, storage } = setup(); const { token } = await service.createSession({});
  const insert = storage.insertRecord.bind(storage); let first = true;
  storage.insertRecord = async value => { const result = await insert(value); if (first) { first = false; throw new Error('lost acknowledgement'); } return result; };
  await assert.rejects(service.saveRecords(token, { records: [record()] }), error => error.acceptedIds.length === 0);
  assert.equal(storage.records.size, 1);
  assert.deepEqual(await service.saveRecords(token, { records: [record()] }), { acceptedIds: [record().id] });
  assert.equal(storage.records.size, 1);
});

test('paginates stable timestamp ties and rejects malformed or forged owner cursors', async () => {
  const { service } = setup(); const { token } = await service.createSession({});
  await service.saveRecords(token, { records: Array.from({ length: 50 }, (_, index) => record(index + 1)) });
  await service.saveRecords(token, { records: [record(51)] });
  const first = await service.listRecords(token, null); const second = await service.listRecords(token, first.nextCursor);
  assert.equal(first.records.length, 50); assert.equal(second.records.length, 1); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.records, ...second.records].map(item => item.id)).size, 51);
  for (const cursor of ['', '*', Buffer.from(JSON.stringify({ ownerHash: hash(token), id: record().id })).toString('base64url')]) await assert.rejects(service.listRecords(token, cursor), { code: 'INVALID_CURSOR' });
});

test('independent limits bound login attempts, session creation and retry windows', () => {
  const { createLimiter } = loadModule('./limits.ts'); const limit = createLimiter();
  for (let i = 0; i < 5; i++) limit('fake-ip', 'admin-login', '', 1000);
  assert.throws(() => limit('fake-ip', 'admin-login', '', 1000), { code: 'RATE_LIMITED' });
  limit('fake-ip', 'admin-login', '', 901000);
  for (let i = 0; i < 10; i++) limit('other-ip', 'session', '', 1000);
  assert.throws(() => limit('other-ip', 'session', '', 1000), { code: 'RATE_LIMITED' });
});
