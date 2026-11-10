import { randomBytes } from 'node:crypto';
import { ArchiveError, unavailable } from './errors';
import { contentHash, hashToken } from './crypto';
import { decodeCursor, encodeCursor, TOKEN_PATTERN, validateBatch, validateSession } from './validation';
import type { ArchivedMessage, ArchiveStorage } from './types';

const PAGE_SIZE = 50;
export class ArchiveService {
  constructor(private storage: ArchiveStorage, private now: () => Date = () => new Date()) {}
  async createSession(raw: unknown) {
    validateSession(raw);
    const token = randomBytes(32).toString('hex');
    await this.storage.createSession(hashToken(token), this.now().toISOString());
    return { token };
  }
  private async owner(token: string | null): Promise<string> {
    if (!token || !TOKEN_PATTERN.test(token)) throw new ArchiveError('UNAUTHORIZED', '云端归档凭证缺失或无效。', 401);
    const ownerHash = hashToken(token);
    if (!await this.storage.hasSession(ownerHash)) throw new ArchiveError('UNAUTHORIZED', '云端归档凭证缺失或无效。', 401);
    return ownerHash;
  }
  async saveRecords(token: string | null, raw: unknown) {
    const ownerHash = await this.owner(token);
    const records = validateBatch(raw);
    const acceptedIds: string[] = [];
    for (const record of records) {
      try {
        const expectedHash = contentHash(record);
        const stored = await this.storage.insertRecord({ record, ownerHash, contentHash: expectedHash, archivedAt: this.now().toISOString() });
        if (stored.contentHash !== expectedHash) throw new ArchiveError('IDEMPOTENCY_CONFLICT', '同一消息标识已用于不同内容，未覆盖原记录。', 409);
        acceptedIds.push(record.id);
      } catch (error) {
        if (error instanceof ArchiveError) throw new ArchiveError(error.code, error.message, error.httpStatus, [...acceptedIds]);
        throw unavailable([...acceptedIds]);
      }
    }
    return { acceptedIds };
  }
  async listRecords(token: string | null, cursorValue: string | null) {
    const ownerHash = await this.owner(token);
    const rows = await this.storage.listRecords(ownerHash, decodeCursor(cursorValue), PAGE_SIZE + 1);
    const visible = rows.slice(0, PAGE_SIZE);
    const records: ArchivedMessage[] = visible.map(row => ({ ...row.record, archivedAt: row.archivedAt }));
    const last = visible[visible.length - 1];
    return { records, nextCursor: rows.length > PAGE_SIZE ? encodeCursor({ id: last.record.id, archivedAt: last.archivedAt }) : null };
  }
}
