import mongoose, { type Model, Schema } from 'mongoose';
import { connectDB } from '../mongodb';
import { contentHash, decryptRecord, encryptionKey, encryptRecord, hashToken } from './crypto';
import { decryptAccountName, encryptAccountName } from './accountNotes';
import { backfillDirections } from './backfillDirections';
import { ArchiveError, unavailable } from './errors';
import type { AccountRow, ArchiveStorage, CloudMessage, EncryptedPayload, StoredMessage } from './types';

type SessionDocument = { _id: string; createdAt: Date };
type AdminSessionDocument = { _id: string; expiresAt: Date };
type AccountNoteDocument = { _id: string; updatedAt: Date; payload: EncryptedPayload };
type RecordDocument = {
  _id: string; ownerHash: string; recordId: string; contentHash: string; archivedAt: Date;
  profileHash: string; peerIdHash: string; occurredAt: Date; direction?: CloudMessage['direction']; payload: EncryptedPayload;
};
const sessionSchema = new Schema<SessionDocument>({ _id: { type: String, required: true }, createdAt: { type: Date, required: true } }, { versionKey: false });
const adminSessionSchema = new Schema<AdminSessionDocument>({ _id: { type: String, required: true }, expiresAt: { type: Date, required: true } }, { versionKey: false });
adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const accountNoteSchema = new Schema<AccountNoteDocument>({ _id: { type: String, required: true }, updatedAt: { type: Date, required: true }, payload: { type: Schema.Types.Mixed, required: true } }, { versionKey: false, strict: 'throw' });
const recordSchema = new Schema<RecordDocument>({
  _id: { type: String, required: true }, ownerHash: { type: String, required: true, immutable: true },
  recordId: { type: String, required: true, immutable: true }, contentHash: { type: String, required: true, immutable: true },
  archivedAt: { type: Date, required: true, immutable: true }, occurredAt: { type: Date, required: true, immutable: true },
  direction: { type: String, enum: ['incoming', 'outgoing'], required: true, immutable: true },
  profileHash: { type: String, required: true, immutable: true }, peerIdHash: { type: String, required: true, immutable: true },
  payload: { type: Schema.Types.Mixed, required: true, immutable: true },
}, { versionKey: false, strict: 'throw' });
recordSchema.index({ ownerHash: 1, recordId: 1 }, { unique: true });
recordSchema.index({ ownerHash: 1, archivedAt: -1, recordId: -1 });
recordSchema.index({ archivedAt: -1, _id: -1 });
recordSchema.index({ profileHash: 1, peerIdHash: 1, occurredAt: -1 });
recordSchema.index({ profileHash: 1, direction: 1, archivedAt: -1, _id: -1 });
recordSchema.index({ direction: 1, profileHash: 1 });
const Session = (mongoose.models.PanghuArchiveSession as Model<SessionDocument> | undefined) ?? mongoose.model<SessionDocument>('PanghuArchiveSession', sessionSchema);
const AdminSession = (mongoose.models.PanghuArchiveAdminSession as Model<AdminSessionDocument> | undefined) ?? mongoose.model<AdminSessionDocument>('PanghuArchiveAdminSession', adminSessionSchema);
const Record = (mongoose.models.PanghuArchiveRecord as Model<RecordDocument> | undefined) ?? mongoose.model<RecordDocument>('PanghuArchiveRecord', recordSchema);
const AccountNote = (mongoose.models.PanghuArchiveAccountNote as Model<AccountNoteDocument> | undefined) ?? mongoose.model<AccountNoteDocument>('PanghuArchiveAccountNote', accountNoteSchema);
const accountNotes = mongoose.connection.collection<AccountNoteDocument>(AccountNote.collection.name);
const sessions = mongoose.connection.collection<SessionDocument>(Session.collection.name);
const adminSessions = mongoose.connection.collection<AdminSessionDocument>(AdminSession.collection.name);
const records = mongoose.connection.collection<RecordDocument>(Record.collection.name);
const writeConcern = { w: 'majority' as const, j: true, wtimeoutMS: 10000 };
let initialization: Promise<void> | null = null;
async function ready(): Promise<Buffer> {
  const key = encryptionKey();
  await connectDB();
  if (!initialization) initialization = Promise.all([Session.init(), AdminSession.init(), Record.init(), AccountNote.init()]).then(() => undefined).catch(error => { initialization = null; throw error; });
  await initialization;
  return key;
}
export function recordStorageId(ownerHash: string, id: string) { return hashToken(JSON.stringify([ownerHash, id])); }
function decode(document: RecordDocument, key: Buffer): StoredMessage {
  const archivedAt = document.archivedAt.toISOString();
  const record = decryptRecord(document.payload, { ownerHash: document.ownerHash, id: document.recordId, contentHash: document.contentHash, archivedAt }, key);
  if (document._id !== recordStorageId(document.ownerHash, record.id) || document.profileHash !== hashToken(record.profile) || document.peerIdHash !== hashToken(record.peerId) || document.occurredAt.toISOString() !== record.occurredAt || document.contentHash !== contentHash(record)) throw unavailable();
  if (document.direction !== undefined && document.direction !== record.direction) throw unavailable();
  return { record, ownerHash: document.ownerHash, contentHash: document.contentHash, archivedAt };
}
async function requireDirections(): Promise<void> {
  if (await Record.exists({ direction: { $exists: false } }).readConcern('majority').maxTimeMS(10000)) throw new ArchiveError('ARCHIVE_UNAVAILABLE', '消息方向索引正在更新，请稍后重试。', 503);
}
export async function backfillRecordDirections(limit = 100) {
  const key = await ready();
  return backfillDirections({
    async readMissing(batchSize) {
      const rows = await Record.find({ direction: { $exists: false } }).sort({ _id: 1 }).limit(batchSize).readConcern('majority').maxTimeMS(10000).lean();
      return rows.map(row => ({ id: row._id, record: decode(row, key).record }));
    },
    async setDirection(id, direction) {
      const result = await records.updateOne({ _id: id, direction: { $exists: false } }, { $set: { direction } }, { writeConcern });
      if (!result.acknowledged) throw unavailable();
      return result.modifiedCount === 1;
    },
  }, limit);
}
export const mongoArchiveStorage: ArchiveStorage = {
  async createSession(hash, createdAt) { await ready(); const result = await sessions.insertOne({ _id: hash, createdAt: new Date(createdAt) }, { writeConcern }); if (!result.acknowledged) throw unavailable(); },
  async hasSession(hash) { await ready(); return !!await Session.exists({ _id: hash }).maxTimeMS(10000); },
  async insertRecord(value) {
    const key = await ready();
    const document: RecordDocument = {
      _id: recordStorageId(value.ownerHash, value.record.id), ownerHash: value.ownerHash, recordId: value.record.id,
      contentHash: value.contentHash, archivedAt: new Date(value.archivedAt), occurredAt: new Date(value.record.occurredAt),
      direction: value.record.direction, profileHash: hashToken(value.record.profile), peerIdHash: hashToken(value.record.peerId),
      payload: encryptRecord(value.record, { ...value, id: value.record.id }, key),
    };
    try {
      const result = await records.insertOne(document, { writeConcern });
      if (!result.acknowledged) throw unavailable();
      return value;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
      // A timed-out insert can still exist locally and later roll back. Only a
      // majority-visible duplicate is safe to acknowledge to the client.
      const existing = await Record.findOne({ ownerHash: value.ownerHash, recordId: value.record.id }).readConcern('majority').maxTimeMS(10000).lean();
      if (!existing) throw error;
      return decode(existing, key);
    }
  },
  async listRecords(ownerHash, cursor, limit) {
    const key = await ready();
    const query = cursor ? { ownerHash, $or: [{ archivedAt: { $lt: new Date(cursor.archivedAt) } }, { archivedAt: new Date(cursor.archivedAt), recordId: { $lt: cursor.id } }] } : { ownerHash };
    return (await Record.find(query).sort({ archivedAt: -1, recordId: -1 }).limit(limit).maxTimeMS(10000).lean()).map(document => decode(document, key));
  },
  async createAdminSession(hash, expiresAt) { await ready(); const result = await adminSessions.insertOne({ _id: hash, expiresAt: new Date(expiresAt) }, { writeConcern }); if (!result.acknowledged) throw unavailable(); },
  async hasAdminSession(hash, now) { await ready(); return !!await AdminSession.exists({ _id: hash, expiresAt: { $gt: new Date(now) } }).maxTimeMS(10000); },
  async deleteAdminSession(hash) { await ready(); const result = await adminSessions.deleteOne({ _id: hash }, { writeConcern }); if (!result.acknowledged) throw unavailable(); },
  async listAccounts(afterProfileHash, limit) {
    const key = await ready();
    await requireDirections();
    type Group = { _id: string; recordKey: string; incomingCount: number; lastReceivedAt: Date | null };
    const groups = await Record.aggregate<Group>([
      ...(afterProfileHash ? [{ $match: { profileHash: { $gt: afterProfileHash } } }] : []),
      { $group: { _id: '$profileHash', recordKey: { $first: '$_id' }, incomingCount: { $sum: { $cond: [{ $eq: ['$direction', 'incoming'] }, 1, 0] } }, lastReceivedAt: { $max: { $cond: [{ $eq: ['$direction', 'incoming'] }, '$occurredAt', null] } } } },
      { $sort: { _id: 1 } }, { $limit: limit },
    ]).readConcern('majority').option({ maxTimeMS: 10000, allowDiskUse: true });
    const [documents, notes] = await Promise.all([
      Record.find({ _id: { $in: groups.map(group => group.recordKey) } }).readConcern('majority').maxTimeMS(10000).lean(),
      AccountNote.find({ _id: { $in: groups.map(group => group._id) } }).readConcern('majority').maxTimeMS(10000).lean(),
    ]);
    const byId = new Map(documents.map(document => [document._id, document]));
    const notesById = new Map(notes.map(note => [note._id, note]));
    return groups.map((group): AccountRow => {
      const document = byId.get(group.recordKey);
      if (!document || !Number.isSafeInteger(group.incomingCount) || group.incomingCount < 0) throw unavailable();
      const { profile } = decode(document, key).record;
      if (hashToken(profile) !== group._id) throw unavailable();
      const note = notesById.get(group._id);
      const name = note ? decryptAccountName(note.payload, { profileHash: note._id, updatedAt: note.updatedAt.toISOString() }, key) : null;
      if (name && name.profile !== profile) throw unavailable();
      return { profileHash: group._id, profile, displayName: name?.displayName ?? null, incomingCount: group.incomingCount, lastReceivedAt: group.lastReceivedAt?.toISOString() ?? null };
    });
  },
  async setAccountName(value, updatedAt) {
    const key = await ready();
    const profileHash = hashToken(value.profile);
    const record = await Record.findOne({ profileHash }).readConcern('majority').maxTimeMS(10000).lean();
    if (!record) throw new ArchiveError('ACCOUNT_NOT_FOUND', '此账号尚无归档消息。', 404);
    if (decode(record, key).record.profile !== value.profile) throw unavailable();
    if (value.displayName === null) {
      const result = await accountNotes.deleteOne({ _id: profileHash }, { writeConcern });
      if (!result.acknowledged) throw unavailable();
    } else {
      const payload = encryptAccountName(value, { profileHash, updatedAt }, key);
      const result = await accountNotes.updateOne({ _id: profileHash }, { $set: { updatedAt: new Date(updatedAt), payload } }, { upsert: true, writeConcern });
      if (!result.acknowledged) throw unavailable();
    }
    return value;
  },
  async listAdminRecords(filters, cursor, limit) {
    const key = await ready();
    if (filters.direction !== null) await requireDirections();
    const query = {
      ...(filters.direction !== null ? { direction: filters.direction } : {}),
      ...(filters.profile !== null ? { profileHash: hashToken(filters.profile) } : {}),
      ...(filters.peerId !== null ? { peerIdHash: hashToken(filters.peerId) } : {}),
      ...(filters.from !== null || filters.to !== null ? { occurredAt: { ...(filters.from !== null ? { $gte: new Date(filters.from) } : {}), ...(filters.to !== null ? { $lte: new Date(filters.to) } : {}) } } : {}),
      ...(cursor ? { $or: [{ archivedAt: { $lt: new Date(cursor.archivedAt) } }, { archivedAt: new Date(cursor.archivedAt), _id: { $lt: cursor.key } }] } : {}),
    };
    return (await Record.find(query).sort({ archivedAt: -1, _id: -1 }).limit(limit).maxTimeMS(10000).lean()).map(document => decode(document, key));
  },
};
