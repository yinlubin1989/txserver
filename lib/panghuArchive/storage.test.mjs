import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { loadModule, record } from './testSupport.mjs';

test('Mongo adapter inserts ciphertext only, requires indexes and acknowledgement, and owner-scopes duplicate/read queries', async () => {
  const previous = process.env.PANGHU_ARCHIVE_ENCRYPTION_KEY;
  try {
    process.env.PANGHU_ARCHIVE_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
    let connects = 0; let initCount = 0; let inserted; let duplicate = false; let acknowledged = true; let majorityVisible = true; let query; let options; let readConcern;
    const response = { readConcern(value) { readConcern = value; return this; }, maxTimeMS() { return this; }, sort() { return this; }, limit() { return this; }, async lean() { return readConcern === 'majority' && !majorityVisible ? null : inserted; } };
    const model = { init: async () => { initCount++; }, collection: { insertOne: async (doc, opts) => { if (duplicate) throw Object.assign(new Error('duplicate'), { code: 11000 }); inserted = structuredClone(doc); options = opts; return { acknowledged }; } }, findOne: value => { query = value; return response; } };
    const overrides = { mongoose: { Schema: mongoose.Schema, connection: { collection: () => model.collection }, models: { PanghuArchiveSession: model, PanghuArchiveAdminSession: model, PanghuArchiveRecord: model, PanghuArchiveAccountNote: model } }, '../mongodb': { connectDB: async () => { connects++; } } };
    const { mongoArchiveStorage } = loadModule('./storage.ts', overrides);
    const { contentHash } = loadModule('./crypto.ts');
    const value = { record: record(), ownerHash: 'a'.repeat(64), contentHash: contentHash(record()), archivedAt: '2026-11-10T01:00:00.000Z' };
    assert.deepEqual(await mongoArchiveStorage.insertRecord(value), value); assert.equal(initCount, 4); assert.equal(connects, 1);
    const serialized = JSON.stringify(inserted); for (const secret of [record().text, record().profile, record().peerId, record().peerName, record().conversationId]) assert.equal(serialized.includes(secret), false);
    assert.deepEqual(options.writeConcern, { w: 'majority', j: true, wtimeoutMS: 10000 });
    duplicate = true; assert.deepEqual(await mongoArchiveStorage.insertRecord(value), value);
    assert.deepEqual(query, { ownerHash: value.ownerHash, recordId: value.record.id });
    assert.equal(readConcern, 'majority');
    // The duplicate exists locally after an ambiguous write, but has not reached
    // majority commit: it must remain unacknowledged so the client keeps it.
    majorityVisible = false; readConcern = undefined;
    await assert.rejects(mongoArchiveStorage.insertRecord(value), { code: 11000 });
    assert.equal(readConcern, 'majority');
    majorityVisible = true;
    model.find = input => { query = input; return { ...response, async lean() { return [inserted]; } }; };
    assert.equal((await mongoArchiveStorage.listRecords(value.ownerHash, null, 51)).length, 1);
    assert.deepEqual(query, { ownerHash: value.ownerHash });
    duplicate = false; acknowledged = false;
    await assert.rejects(mongoArchiveStorage.insertRecord(value), { code: 'ARCHIVE_UNAVAILABLE' });
    delete process.env.PANGHU_ARCHIVE_ENCRYPTION_KEY;
    await assert.rejects(mongoArchiveStorage.insertRecord(value), { code: 'ARCHIVE_UNAVAILABLE' }); assert.equal(connects, 5);
  } finally { if (previous === undefined) delete process.env.PANGHU_ARCHIVE_ENCRYPTION_KEY; else process.env.PANGHU_ARCHIVE_ENCRYPTION_KEY = previous; }
});

test('Mongo account and direction filters fail closed for legacy metadata, and backfill changes direction only', async () => {
  const previous = process.env.PANGHU_ARCHIVE_ENCRYPTION_KEY;
  try {
    process.env.PANGHU_ARCHIVE_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    const { contentHash, encryptRecord, hashToken } = loadModule('./crypto.ts');
    const original = record(); const ownerHash = 'a'.repeat(64); const archivedAt = '2026-11-10T01:00:00.000Z'; const digest = contentHash(original);
    const document = { _id: hashToken(JSON.stringify([ownerHash, original.id])), ownerHash, recordId: original.id, contentHash: digest, archivedAt: new Date(archivedAt), occurredAt: new Date(original.occurredAt), profileHash: hashToken(original.profile), peerIdHash: hashToken(original.peerId), payload: encryptRecord(original, { ownerHash, id: original.id, contentHash: digest, archivedAt }, Buffer.alloc(32, 9)) };
    const before = structuredClone(document); let query; let mutation; let aggregationCalled = false; let majorityChecks = 0;
    const chain = { readConcern(level) { assert.equal(level, 'majority'); majorityChecks++; return this; }, maxTimeMS() { return this; }, sort() { return this; }, limit() { return this; }, async lean() { return query.direction?.$exists === false && document.direction ? [] : [document]; } };
    const model = {
      init: async () => {}, collection: { updateOne: async (filter, change, options) => { mutation = { filter, change, options }; if (document.direction) return { acknowledged: true, modifiedCount: 0 }; document.direction = change.$set.direction; return { acknowledged: true, modifiedCount: 1 }; } },
      find: value => { query = value; return chain; },
      exists: () => ({ readConcern(level) { assert.equal(level, 'majority'); return this; }, async maxTimeMS() { return document.direction ? null : { _id: document._id }; } }),
      aggregate: () => { aggregationCalled = true; throw new Error('should not aggregate legacy data'); },
    };
    const { mongoArchiveStorage, backfillRecordDirections } = loadModule('./storage.ts', { mongoose: { Schema: mongoose.Schema, connection: { collection: () => model.collection }, models: { PanghuArchiveSession: model, PanghuArchiveAdminSession: model, PanghuArchiveRecord: model, PanghuArchiveAccountNote: model } }, '../mongodb': { connectDB: async () => {} } });
    const filters = { profile: original.profile, peerId: null, from: null, to: null, direction: 'incoming' };
    await assert.rejects(mongoArchiveStorage.listAccounts(null, 51), { code: 'ARCHIVE_UNAVAILABLE', message: '消息方向索引正在更新，请稍后重试。' });
    await assert.rejects(mongoArchiveStorage.listAdminRecords(filters, null, 51), { code: 'ARCHIVE_UNAVAILABLE' });
    assert.equal(aggregationCalled, false);
    assert.equal((await mongoArchiveStorage.listAdminRecords({ ...filters, direction: null }, null, 51)).length, 1);
    assert.deepEqual(await backfillRecordDirections(10), { scanned: 1, updated: 1, complete: false });
    assert.deepEqual(mutation.filter, { _id: document._id, direction: { $exists: false } });
    assert.deepEqual(mutation.change, { $set: { direction: 'incoming' } });
    assert.deepEqual(mutation.options.writeConcern, { w: 'majority', j: true, wtimeoutMS: 10000 });
    assert.deepEqual(document, { ...before, direction: 'incoming' });
    assert.deepEqual(await backfillRecordDirections(10), { scanned: 0, updated: 0, complete: true });
    assert.equal((await mongoArchiveStorage.listAdminRecords(filters, null, 51)).length, 1);
    assert.equal(query.direction, 'incoming'); assert.equal(query.profileHash, hashToken(original.profile));
    document.direction = 'outgoing';
    await assert.rejects(mongoArchiveStorage.listRecords(ownerHash, null, 51), { code: 'ARCHIVE_UNAVAILABLE' });
    assert.ok(majorityChecks >= 2);
  } finally { if (previous === undefined) delete process.env.PANGHU_ARCHIVE_ENCRYPTION_KEY; else process.env.PANGHU_ARCHIVE_ENCRYPTION_KEY = previous; }
});
