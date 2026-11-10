import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ArchiveError, unavailable } from './errors';
import { canonical, hashToken } from './crypto';
import { decodeAdminCursor, encodeAdminCursor, TOKEN_PATTERN, validateAdminFilters, validatePassword } from './validation';
import type { ArchiveStorage } from './types';

export const ADMIN_COOKIE = 'panghu_archive_admin';
export const ADMIN_SESSION_SECONDS = 12 * 60 * 60;
export class ArchiveAdminService {
  constructor(private storage: ArchiveStorage, private now: () => Date = () => new Date()) {}
  async login(raw: unknown) {
    const password = validatePassword(raw);
    const passwordHash = process.env.PANGHU_ARCHIVE_ADMIN_PASSWORD_HASH;
    if (!passwordHash || !/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(passwordHash)) throw unavailable();
    if (!await bcrypt.compare(password, passwordHash)) throw new ArchiveError('UNAUTHORIZED', '管理员密码不正确。', 401);
    const token = randomBytes(32).toString('hex');
    await this.storage.createAdminSession(hashToken(token), new Date(this.now().getTime() + ADMIN_SESSION_SECONDS * 1000).toISOString());
    return { token };
  }
  async authenticate(token: string | null): Promise<void> {
    if (!token || !TOKEN_PATTERN.test(token) || !await this.storage.hasAdminSession(hashToken(token), this.now().toISOString())) throw new ArchiveError('UNAUTHORIZED', '请先登录管理员账号。', 401);
  }
  async logout(token: string | null) {
    if (token && TOKEN_PATTERN.test(token)) await this.storage.deleteAdminSession(hashToken(token));
  }
  async listRecords(token: string | null, parameters: URLSearchParams) {
    await this.authenticate(token);
    const filters = validateAdminFilters(parameters);
    const filterHash = hashToken(canonical(filters));
    const cursor = decodeAdminCursor(parameters.get('cursor'), filterHash);
    const rows = await this.storage.listAdminRecords(filters, cursor, 51);
    const visible = rows.slice(0, 50);
    const last = visible[visible.length - 1];
    return {
      records: visible.map(row => ({ ...row.record, archivedAt: row.archivedAt, ownerId: row.ownerHash.slice(0, 12) })),
      nextCursor: rows.length > 50 ? encodeAdminCursor({ archivedAt: last.archivedAt, key: hashToken(JSON.stringify([last.ownerHash, last.record.id])), filterHash }) : null,
    };
  }
}
