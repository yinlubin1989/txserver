import type { CloudMessage } from './types';

type LegacyRecord = { id: string; record: CloudMessage };
export interface DirectionBackfillStorage {
  readMissing(limit: number): Promise<LegacyRecord[]>;
  setDirection(id: string, direction: CloudMessage['direction']): Promise<boolean>;
}
/** One bounded, restartable batch. Every direction comes from authenticated plaintext. */
export async function backfillDirections(storage: DirectionBackfillStorage, limit = 100) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('回填批次必须为 1 至 500。');
  const rows = await storage.readMissing(limit);
  let updated = 0;
  for (const row of rows) if (await storage.setDirection(row.id, row.record.direction)) updated++;
  return { scanned: rows.length, updated, complete: rows.length === 0 };
}
