import { createHash, randomBytes } from 'node:crypto';
import { LedgerError } from './errors';
import { decodeCursor, encodeCursor, TOKEN_PATTERN, validateId, validateSave } from './validation';
import type { Bill, LedgerStorage, StoredBill } from './types';

const PAGE_SIZE = 20;
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function ownerBill(bill: StoredBill): Bill { return { id: bill.id, createdAt: bill.createdAt, report: bill.report, text: bill.text }; }
const missing = () => new LedgerError('BILL_NOT_FOUND', '这张账单不存在或无法访问。', 404);

export class LedgerService {
  constructor(private storage: LedgerStorage, private now: () => Date = () => new Date()) {}

  async createSession() {
    const token = randomBytes(32).toString('hex');
    await this.storage.createSession(hashToken(token), this.now().toISOString());
    return { token };
  }

  private async owner(token: string | null) {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw new LedgerError('UNAUTHORIZED', '账本凭证缺失，请重新打开账本。', 401);
    const hash = hashToken(token);
    if (!await this.storage.hasSession(hash)) throw new LedgerError('UNAUTHORIZED', '账本凭证无效，无法访问原账本。', 401);
    return hash;
  }

  async saveBill(token: string | null, raw: unknown) {
    const ownerHash = await this.owner(token);
    const input = validateSave(raw);
    const contentHash = hashToken(canonical({ report: input.report, text: input.text }));
    const result = await this.storage.insertBill({ ...input, id: randomBytes(12).toString('hex'), ownerHash, contentHash, createdAt: this.now().toISOString(), shareToken: null });
    if (result.bill.contentHash !== contentHash) throw new LedgerError('IDEMPOTENCY_CONFLICT', '这次保存标识已用于另一份账单，请重新保存。', 409);
    return { bill: ownerBill(result.bill), created: result.created };
  }

  async listBills(token: string | null, cursorValue: string | null) {
    const ownerHash = await this.owner(token);
    const cursor = decodeCursor(cursorValue);
    const found = await this.storage.listBills(ownerHash, cursor, PAGE_SIZE + 1);
    const visible = found.slice(0, PAGE_SIZE);
    return {
      bills: visible.map(bill => ({ id: bill.id, createdAt: bill.createdAt, period: bill.report.period, totals: bill.report.totals, reviewCount: bill.report.warnings.filter(warning => warning.severity === 'review').length })),
      nextCursor: found.length > PAGE_SIZE ? encodeCursor(visible[visible.length - 1]) : null,
    };
  }

  async getBill(token: string | null, id: string) {
    const ownerHash = await this.owner(token); validateId(id);
    const bill = await this.storage.findBill(ownerHash, id);
    if (!bill) throw missing();
    return ownerBill(bill);
  }

  async shareBill(token: string | null, id: string) {
    const ownerHash = await this.owner(token); validateId(id);
    const bill = await this.storage.assignShareToken(ownerHash, id, randomBytes(32).toString('hex'));
    if (!bill || !bill.shareToken) throw missing();
    return { token: bill.shareToken };
  }

  async getSharedBill(token: string) {
    if (!TOKEN_PATTERN.test(token)) throw missing();
    const bill = await this.storage.findSharedBill(token);
    if (!bill) throw missing();
    // The share capability grants access to exactly this result, not the private input or owner's ledger.
    return { id: bill.id, createdAt: bill.createdAt, report: bill.report };
  }
}
