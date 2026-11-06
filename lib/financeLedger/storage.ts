import mongoose, { type Model, Schema } from 'mongoose';
import { connectDB } from '../mongodb';
import type { BillCursor, FinanceReport, LedgerStorage, StoredBill } from './types';

type SessionDocument = { _id: string; createdAt: Date };
type BillDocument = Omit<StoredBill, 'id' | 'createdAt' | 'deletedAt'> & { _id: string; createdAt: Date; deletedAt: Date | null };
const sessionSchema = new Schema<SessionDocument>({ _id: { type: String, required: true }, createdAt: { type: Date, required: true } }, { versionKey: false });
const billSchema = new Schema<BillDocument>({
  _id: { type: String, required: true },
  ownerHash: { type: String, required: true, immutable: true },
  clientRequestId: { type: String, required: true, immutable: true },
  contentHash: { type: String, required: true, immutable: true },
  createdAt: { type: Date, required: true, immutable: true },
  report: { type: Schema.Types.Mixed, required: true, immutable: true },
  text: { type: String, required: true, immutable: true },
  shareToken: { type: String, default: null },
  visibility: { type: String, enum: ['private', 'public'], required: true, default: 'private' },
  deletedAt: { type: Date, default: null },
}, { versionKey: false });
billSchema.index({ ownerHash: 1, clientRequestId: 1 }, { unique: true });
billSchema.index({ ownerHash: 1, createdAt: -1, _id: -1 });
billSchema.index({ shareToken: 1 }, { unique: true, partialFilterExpression: { shareToken: { $type: 'string' } } });
const Session = (mongoose.models.FinanceLedgerSession as Model<SessionDocument> | undefined) ?? mongoose.model<SessionDocument>('FinanceLedgerSession', sessionSchema);
const SavedBill = (mongoose.models.FinanceLedgerBill as Model<BillDocument> | undefined) ?? mongoose.model<BillDocument>('FinanceLedgerBill', billSchema);

function bill(document: BillDocument): StoredBill {
  return { id: document._id, createdAt: document.createdAt.toISOString(), ownerHash: document.ownerHash, clientRequestId: document.clientRequestId, contentHash: document.contentHash, report: document.report as FinanceReport, text: document.text, shareToken: document.shareToken, visibility: document.visibility, deletedAt: document.deletedAt?.toISOString() ?? null };
}
let initialization: Promise<void> | null = null;
async function ready() {
  await connectDB();
  if (!initialization) {
    initialization = (async () => {
      await Promise.all([Session.init(), SavedBill.init()]);
      // One-time compatibility migration: pre-visibility shares were already public.
      await SavedBill.updateMany({ visibility: { $exists: false } }, [{ $set: {
        visibility: { $cond: [{ $eq: [{ $type: '$shareToken' }, 'string'] }, 'public', 'private'] },
      } }], { maxTimeMS: 10000 });
    })().catch(error => { initialization = null; throw error; });
  }
  await initialization;
}

export const mongoLedgerStorage: LedgerStorage = {
  async createSession(tokenHash, createdAt) { await ready(); await Session.create({ _id: tokenHash, createdAt: new Date(createdAt) }); },
  async hasSession(tokenHash) { await ready(); return !!await Session.exists({ _id: tokenHash }).maxTimeMS(10000); },
  async insertBill(value) {
    await ready();
    try {
      const created = await SavedBill.create({ ...value, _id: value.id, createdAt: new Date(value.createdAt) });
      return { bill: bill(created.toObject()), created: true };
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
      const existing = await SavedBill.findOne({ ownerHash: value.ownerHash, clientRequestId: value.clientRequestId }).maxTimeMS(10000).lean();
      if (!existing) throw error;
      return { bill: bill(existing), created: false };
    }
  },
  async listBills(ownerHash, cursor: BillCursor | null, limit) {
    await ready();
    const query = cursor ? { ownerHash, deletedAt: null, $or: [{ createdAt: { $lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), _id: { $lt: cursor.id } }] } : { ownerHash, deletedAt: null };
    return (await SavedBill.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit).maxTimeMS(10000).lean()).map(bill);
  },
  async findBill(ownerHash, id) {
    await ready(); const found = await SavedBill.findOne({ _id: id, ownerHash, deletedAt: null }).maxTimeMS(10000).lean(); return found ? bill(found) : null;
  },
  async assignShareToken(ownerHash, id, token) {
    await ready();
    // Publishing and token allocation are atomic, including concurrent private/delete requests.
    const found = await SavedBill.findOneAndUpdate({ _id: id, ownerHash, deletedAt: null }, [{ $set: { visibility: 'public', shareToken: { $ifNull: ['$shareToken', token] } } }], { new: true, maxTimeMS: 10000 }).lean();
    return found ? bill(found) : null;
  },
  async setVisibility(ownerHash, id, visibility) {
    await ready();
    const update = visibility === 'private' ? { visibility, shareToken: null } : { visibility };
    const found = await SavedBill.findOneAndUpdate({ _id: id, ownerHash, deletedAt: null }, { $set: update }, { new: true, maxTimeMS: 10000 }).lean();
    return found ? bill(found) : null;
  },
  async deleteBill(ownerHash, id, deletedAt) {
    await ready();
    // Keep the idempotency tombstone so a delayed save retry cannot resurrect a deleted bill.
    const result = await SavedBill.updateOne({ _id: id, ownerHash }, { $set: { deletedAt: new Date(deletedAt), visibility: 'private', shareToken: null } }, { maxTimeMS: 10000 });
    return result.matchedCount === 1;
  },
  async findSharedBill(token) {
    await ready(); const found = await SavedBill.findOne({ shareToken: token, visibility: 'public', deletedAt: null }).maxTimeMS(10000).lean(); return found ? bill(found) : null;
  },
};
