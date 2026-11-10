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
    const overrides = { mongoose: { Schema: mongoose.Schema, connection: { collection: () => model.collection }, models: { PanghuArchiveSession: model, PanghuArchiveAdminSession: model, PanghuArchiveRecord: model } }, '../mongodb': { connectDB: async () => { connects++; } } };
    const { mongoArchiveStorage } = loadModule('./storage.ts', overrides);
    const { contentHash } = loadModule('./crypto.ts');
    const value = { record: record(), ownerHash: 'a'.repeat(64), contentHash: contentHash(record()), archivedAt: '2026-11-10T01:00:00.000Z' };
    assert.deepEqual(await mongoArchiveStorage.insertRecord(value), value); assert.equal(initCount, 3); assert.equal(connects, 1);
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
