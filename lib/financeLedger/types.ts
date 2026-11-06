import type { calculateLedger } from '../financeStatistics/ledger';

export type FinanceReport = ReturnType<typeof calculateLedger>;
export type Visibility = 'private' | 'public';
export type Bill = { id: string; createdAt: string; report: FinanceReport; text: string; visibility: Visibility };
export type StoredBill = Bill & { ownerHash: string; clientRequestId: string; contentHash: string; shareToken: string | null; deletedAt: string | null };
export type BillCursor = { createdAt: string; id: string };
export type SaveInput = { report: FinanceReport; text: string; clientRequestId: string };

export interface LedgerStorage {
  createSession(tokenHash: string, createdAt: string): Promise<void>;
  hasSession(tokenHash: string): Promise<boolean>;
  insertBill(bill: StoredBill): Promise<{ bill: StoredBill; created: boolean }>;
  listBills(ownerHash: string, cursor: BillCursor | null, limit: number): Promise<StoredBill[]>;
  findBill(ownerHash: string, id: string): Promise<StoredBill | null>;
  assignShareToken(ownerHash: string, id: string, token: string): Promise<StoredBill | null>;
  setVisibility(ownerHash: string, id: string, visibility: Visibility): Promise<StoredBill | null>;
  deleteBill(ownerHash: string, id: string, deletedAt: string): Promise<boolean>;
  findSharedBill(token: string): Promise<StoredBill | null>;
}
