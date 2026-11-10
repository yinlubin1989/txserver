import mongoose, { type Model, Schema } from 'mongoose';
import { connectDB } from '../mongodb';
import { contentHash, decryptRecord, encryptionKey, encryptRecord, hashToken } from './crypto';
import { unavailable } from './errors';
import type { ArchiveStorage, EncryptedPayload, StoredMessage } from './types';

type SessionDocument = { _id: string; createdAt: Date };
type AdminSessionDocument = { _id: string; expiresAt: Date };
type RecordDocument = {
  _id: string; ownerHash: string; recordId: string; contentHash: string; archivedAt: Date;
  profileHash: string; peerIdHash: string; occurredAt: Date; payload: EncryptedPayload;
};
const sessionSchema = new Schema<SessionDocument>({ _id: { type: String, required: true }, createdAt: { type: Date, required: true } }, { versionKey: false });
const adminSessionSchema = new Schema<AdminSessionDocument>({ _id: { type: String, required: true }, expiresAt: { type: Date, required: true } }, { versionKey: false });
adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const recordSchema = new Schema<RecordDocument>({
  _id: { type: String, required: true }, ownerHash: { type: String, required: true, immutable: true },
  recordId: { type: String, required: true, immutable: true }, contentHash: { type: String, required: true, immutable: true },
  archivedAt: { type: Date, required: true, immutable: true }, occurredAt: { type: Date, required: true, immutable: true },
  profileHash: { type: String, required: true, immutable: true }, peerIdHash: { type: String, required: true, immutable: true },
  payload: { type: Schema.Types.Mixed, required: true, immutable: true },
}, { versionKey: false, strict: 'throw' });
recordSchema.index({ ownerHash: 1, recordId: 1 }, { unique: true });
recordSchema.index({ ownerHash: 1, archivedAt: -1, recordId: -1 });
recordSchema.index({ archivedAt: -1, _id: -1 });
recordSchema.index({ profileHash: 1, peerIdHash: 1, occurredAt: -1 });
const Session = (mongoose.models.PanghuArchiveSession as Model<SessionDocument> | undefined) ?? mongoose.model<SessionDocument>('PanghuArchiveSession', sessionSchema);
const AdminSession = (mongoose.models.PanghuArchiveAdminSession as Model<AdminSessionDocument> | undefined) ?? mongoose.model<AdminSessionDocument>('PanghuArchiveAdminSession', adminSessionSchema);
const Record = (mongoose.models.PanghuArchiveRecord as Model<RecordDocument> | undefined) ?? mongoose.model<RecordDocument>('PanghuArchiveRecord', recordSchema);
const sessions = mongoose.connection.collection<SessionDocument>(Session.collection.name);
const adminSessions = mongoose.connection.collection<AdminSessionDocument>(AdminSession.collection.name);
const records = mongoose.connection.collection<RecordDocument>(Record.collection.name);
const writeConcern = { w: 'majority' as const, j: true, wtimeoutMS: 10000 };
let initialization: Promise<void> | null = null;
async function ready(): Promise<Buffer> {
  const key = encryptionKey();
  await connectDB();
  if (!initialization) initialization = Promise.all([Session.init(), AdminSession.init(), Record.init()]).then(() => undefined).catch(error => { initialization = null; throw error; });
  await initialization;
  return key;
}
export function recordStorageId(ownerHash: string, id: string) { return hashToken(JSON.stringify([ownerHash, id])); }
function decode(document: RecordDocument, key: Buffer): StoredMessage {
  const archivedAt = document.archivedAt.toISOString();
  const record = decryptRecord(document.payload, { ownerHash: document.ownerHash, id: document.recordId, contentHash: document.contentHash, archivedAt }, key);
  if (document._id !== recordStorageId(document.ownerHash, record.id) || document.profileHash !== hashToken(record.profile) || document.peerIdHash !== hashToken(record.peerId) || document.occurredAt.toISOString() !== record.occurredAt || document.contentHash !== contentHash(record)) throw unavailable();
  return { record, ownerHash: document.ownerHash, contentHash: document.contentHash, archivedAt };
}
export const mongoArchiveStorage: ArchiveStorage = {
  async createSession(hash, createdAt) { await ready(); const result = await sessions.insertOne({ _id: hash, createdAt: new Date(createdAt) }, { writeConcern }); if (!result.acknowledged) throw unavailable(); },
  async hasSession(hash) { await ready(); return !!await Session.exists({ _id: hash }).maxTimeMS(10000); },
  async insertRecord(value) {
    const key = await ready();
    const document: RecordDocument = {
      _id: recordStorageId(value.ownerHash, value.record.id), ownerHash: value.ownerHash, recordId: value.record.id,
      contentHash: value.contentHash, archivedAt: new Date(value.archivedAt), occurredAt: new Date(value.record.occurredAt),
      profileHash: hashToken(value.record.profile), peerIdHash: hashToken(value.record.peerId),
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
  async listAdminRecords(filters, cursor, limit) {
    const key = await ready();
    const query = {
      ...(filters.profile !== null ? { profileHash: hashToken(filters.profile) } : {}),
      ...(filters.peerId !== null ? { peerIdHash: hashToken(filters.peerId) } : {}),
      ...(filters.from !== null || filters.to !== null ? { occurredAt: { ...(filters.from !== null ? { $gte: new Date(filters.from) } : {}), ...(filters.to !== null ? { $lte: new Date(filters.to) } : {}) } } : {}),
      ...(cursor ? { $or: [{ archivedAt: { $lt: new Date(cursor.archivedAt) } }, { archivedAt: new Date(cursor.archivedAt), _id: { $lt: cursor.key } }] } : {}),
    };
    return (await Record.find(query).sort({ archivedAt: -1, _id: -1 }).limit(limit).maxTimeMS(10000).lean()).map(document => decode(document, key));
  },
};
