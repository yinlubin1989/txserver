import mongoose, { type Model, Schema } from 'mongoose';
import { connectDB } from '../mongodb';
import type { BillCursor, FinanceReport, LedgerStorage, StoredBill } from './types';

type SessionDocument = { _id: string; createdAt: Date; accountHash?: string; claimedBy?: string; expiresAt?: Date };
type BillDocument = Omit<StoredBill, 'id' | 'createdAt' | 'deletedAt'> & { _id: string; createdAt: Date; deletedAt: Date | null };
const sessionSchema = new Schema<SessionDocument>({ _id: { type: String, required: true }, createdAt: { type: Date, required: true }, accountHash: String, claimedBy: String, expiresAt: Date }, { versionKey: false });
sessionSchema.index({ claimedBy: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
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
      } }], { maxTimeMS: 10000, updatePipeline: true });
    })().catch(error => { initialization = null; throw error; });
  }
  await initialization;
}

// Bind the old credential instead of moving immutable bills. Legacy credentials keep
// their original scope; only a verified WeChat session can read the combined ledger.
async function ownerFilter(ownerHash: string) {
  const legacy = await Session.find({ claimedBy: ownerHash }).select('_id').maxTimeMS(10000).lean();
  return { $in: [ownerHash, ...legacy.map(session => session._id)] };
}

export const mongoLedgerStorage: LedgerStorage = {
  async createSession(tokenHash, createdAt) { await ready(); await Session.create({ _id: tokenHash, createdAt: new Date(createdAt) }); },
  async sessionOwner(tokenHash, now) {
    await ready();
    const session = await Session.findById(tokenHash).maxTimeMS(10000).lean();
    if (!session || (session.expiresAt && session.expiresAt <= new Date(now))) return null;
    return session.accountHash ?? tokenHash;
  },
  async createWechatSession(tokenHash, accountHash, createdAt, expiresAt) {
    await ready();
    await Session.create({ _id: tokenHash, accountHash, createdAt: new Date(createdAt), expiresAt: new Date(expiresAt) });
  },
  async claimLegacySession(tokenHash, accountHash) {
    await ready();
    const claimed = await Session.findOneAndUpdate({ _id: tokenHash, accountHash: { $exists: false },
      $or: [{ claimedBy: { $exists: false } }, { claimedBy: accountHash }],
    }, { $set: { claimedBy: accountHash } }, { returnDocument: 'after', maxTimeMS: 10000 }).lean();
    return claimed !== null;
  },
  async insertBill(value) {
    await ready();
    const previous = await SavedBill.findOne({ ownerHash: await ownerFilter(value.ownerHash), clientRequestId: value.clientRequestId }).maxTimeMS(10000).lean();
    if (previous) return { bill: bill(previous), created: false };
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
    const owners = await ownerFilter(ownerHash);
    const query = cursor ? { ownerHash: owners, deletedAt: null, $or: [{ createdAt: { $lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), _id: { $lt: cursor.id } }] } : { ownerHash: owners, deletedAt: null };
    return (await SavedBill.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit).maxTimeMS(10000).lean()).map(bill);
  },
  async findBill(ownerHash, id) {
    await ready(); const found = await SavedBill.findOne({ _id: id, ownerHash: await ownerFilter(ownerHash), deletedAt: null }).maxTimeMS(10000).lean(); return found ? bill(found) : null;
  },
  async assignShareToken(ownerHash, id, token) {
    await ready();
    // Publishing and token allocation are atomic, including concurrent private/delete requests.
    const found = await SavedBill.findOneAndUpdate({ _id: id, ownerHash: await ownerFilter(ownerHash), deletedAt: null }, [{ $set: { visibility: 'public', shareToken: { $ifNull: ['$shareToken', token] } } }], { returnDocument: 'after', maxTimeMS: 10000, updatePipeline: true }).lean();
    return found ? bill(found) : null;
  },
  async setVisibility(ownerHash, id, visibility) {
    await ready();
    const update = visibility === 'private' ? { visibility, shareToken: null } : { visibility };
    const found = await SavedBill.findOneAndUpdate({ _id: id, ownerHash: await ownerFilter(ownerHash), deletedAt: null }, { $set: update }, { returnDocument: 'after', maxTimeMS: 10000 }).lean();
    return found ? bill(found) : null;
  },
  async deleteBill(ownerHash, id, deletedAt) {
    await ready();
    // Keep the idempotency tombstone so a delayed save retry cannot resurrect a deleted bill.
    const result = await SavedBill.updateOne({ _id: id, ownerHash: await ownerFilter(ownerHash) }, { $set: { deletedAt: new Date(deletedAt), visibility: 'private', shareToken: null } }, { maxTimeMS: 10000 });
    return result.matchedCount === 1;
  },
  async findSharedBill(token) {
    await ready(); const found = await SavedBill.findOne({ shareToken: token, visibility: 'public', deletedAt: null }).maxTimeMS(10000).lean(); return found ? bill(found) : null;
  },
};
