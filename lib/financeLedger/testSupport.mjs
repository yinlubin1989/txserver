import { loadModule } from '../financeStatistics/testLoader.mjs';
const { LedgerService } = loadModule('../financeLedger/service.ts');

function report() {
  return {
    schemaVersion: 1, status: 'completed', period: { year: null, month: 10 },
    dailyRows: [{ day: 1, incomeCents: 10000, expenseCents: 15000, profitCents: -5000, commissionCheck: null, details: [
      { label: '花束', category: 'income', amountCents: 10000, unitPriceCents: 10000, quantity: 1, quantityUnit: '束', source: '100元1束100元', included: false, accountingNote: null },
      { label: '进货', category: 'purchase', amountCents: 15000, unitPriceCents: null, quantity: null, quantityUnit: null, source: '进货150元', included: false, accountingNote: null },
      { label: '耗材', category: 'supplies', amountCents: 1000, unitPriceCents: null, quantity: null, quantityUnit: null, source: '进货含耗材10元', included: true, accountingNote: '已包含于进货' },
    ] }],
    totals: { days: 1, incomeCents: 10000, expenseCents: 15000, profitCents: -5000 },
    breakdown: { incomeByPrice: [{ unitPriceCents: 10000, quantity: 1, quantityUnit: '束', amountCents: 10000 }], unclassifiedIncomeCents: 0, expenses: [
      { category: 'redPacket', amountCents: 0 }, { category: 'purchase', amountCents: 15000 }, { category: 'commission', amountCents: 0 }, { category: 'supplies', amountCents: 0 }, { category: 'other', amountCents: 0 },
    ] },
    warnings: [{ code: 'INCLUDED', date: '10月1日', message: '耗材已包含于进货', severity: 'info' }],
  };
}
function input(clientRequestId = 'bill_request_0001') { return { report: report(), text: '10月1日 原始聊天全文', clientRequestId }; }
class MemoryStorage {
  sessions = new Map();
  bills = new Map();
  async createSession(hash, createdAt) { this.sessions.set(hash, createdAt); }
  async hasSession(hash) { return this.sessions.has(hash); }
  async insertBill(bill) {
    const existing = [...this.bills.values()].find(row => row.ownerHash === bill.ownerHash && row.clientRequestId === bill.clientRequestId);
    if (existing) return { bill: structuredClone(existing), created: false };
    this.bills.set(bill.id, structuredClone(bill)); return { bill: structuredClone(bill), created: true };
  }
  async listBills(ownerHash, cursor, limit) {
    return [...this.bills.values()].filter(bill => bill.ownerHash === ownerHash && bill.deletedAt === null && (!cursor || bill.createdAt < cursor.createdAt || bill.createdAt === cursor.createdAt && bill.id < cursor.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, limit).map(bill => structuredClone(bill));
  }
  async findBill(ownerHash, id) { const bill = this.bills.get(id); return bill?.ownerHash === ownerHash && bill.deletedAt === null ? structuredClone(bill) : null; }
  async assignShareToken(ownerHash, id, token) {
    const bill = this.bills.get(id); if (bill?.ownerHash !== ownerHash || bill.deletedAt !== null) return null;
    bill.visibility = 'public'; bill.shareToken ??= token; return structuredClone(bill);
  }
  async setVisibility(ownerHash, id, visibility) {
    const bill = this.bills.get(id); if (bill?.ownerHash !== ownerHash || bill.deletedAt !== null) return null;
    bill.visibility = visibility;
    if (visibility === 'private') bill.shareToken = null;
    return structuredClone(bill);
  }
  async deleteBill(ownerHash, id, deletedAt) {
    const bill = this.bills.get(id); if (bill?.ownerHash !== ownerHash) return false;
    Object.assign(bill, { deletedAt, visibility: 'private', shareToken: null }); return true;
  }
  async findSharedBill(token) { const bill = [...this.bills.values()].find(bill => bill.shareToken === token && bill.visibility === 'public' && bill.deletedAt === null); return bill ? structuredClone(bill) : null; }
}
function setup() { const storage = new MemoryStorage(); const service = new LedgerService(storage, () => new Date('2026-11-06T08:30:00.000Z')); return { storage, service }; }


export { report, input, setup };
