import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule, record } from './testSupport.mjs';
const crypto = loadModule('./crypto.ts');
const key = Buffer.alloc(32, 7);
const binding = { id: record().id, ownerHash: 'a'.repeat(64), contentHash: crypto.contentHash(record()), archivedAt: '2026-11-10T00:00:00.000Z' };

test('requires canonical 32-byte base64 and never defaults to plaintext', () => {
  const previous = process.env.PANGHU_ARCHIVE_ENCRYPTION_KEY;
  try {
    for (const value of ['', 'invalid', Buffer.alloc(31).toString('base64'), `${key.toString('base64')}\n`]) {
      process.env.PANGHU_ARCHIVE_ENCRYPTION_KEY = value;
      assert.throws(() => crypto.encryptionKey(), { code: 'ARCHIVE_UNAVAILABLE' });
    }
    process.env.PANGHU_ARCHIVE_ENCRYPTION_KEY = key.toString('base64'); assert.deepEqual(crypto.encryptionKey(), key);
  } finally { if (previous === undefined) delete process.env.PANGHU_ARCHIVE_ENCRYPTION_KEY; else process.env.PANGHU_ARCHIVE_ENCRYPTION_KEY = previous; }
});

test('encrypts complete message with random IV and authenticates payload, owner, ID, time and hash', () => {
  const first = crypto.encryptRecord(record(), binding, key); const second = crypto.encryptRecord(record(), binding, key);
  assert.notEqual(first.iv, second.iv); assert.notEqual(first.data, second.data);
  assert.equal(JSON.stringify(first).includes(record().text), false);
  assert.equal(JSON.stringify(first).includes(record().profile), false);
  assert.deepEqual(crypto.decryptRecord(first, binding, key), record());
  for (const changed of [{ ownerHash: 'b'.repeat(64) }, { id: 'c'.repeat(64) }, { archivedAt: '2026-11-11T00:00:00.000Z' }, { contentHash: 'd'.repeat(64) }]) assert.throws(() => crypto.decryptRecord(first, { ...binding, ...changed }, key), { code: 'ARCHIVE_UNAVAILABLE' });
  assert.throws(() => crypto.decryptRecord(first, binding, Buffer.alloc(32, 8)), { code: 'ARCHIVE_UNAVAILABLE' });
  const bytes = Buffer.from(first.data, 'base64'); bytes[0] ^= 1;
  assert.throws(() => crypto.decryptRecord({ ...first, data: bytes.toString('base64') }, binding, key), { code: 'ARCHIVE_UNAVAILABLE' });
  assert.throws(() => crypto.decryptRecord({ ...first, version: 2 }, binding, key), { code: 'ARCHIVE_UNAVAILABLE' });
});
