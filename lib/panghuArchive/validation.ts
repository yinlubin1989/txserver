import { ArchiveError, invalid } from './errors';
import type { AccountName, AdminCursor, AdminFilters, ArchiveCursor, CloudMessage } from './types';

export const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
export const MAX_BATCH_SIZE = 50;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
const RECORD_KEYS = ['id', 'profile', 'direction', 'source', 'peerId', 'peerName', 'conversationId', 'text', 'occurredAt', 'status', 'sourceId'];

function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
}
function text(value: unknown, maximum: number, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > maximum) invalid();
}
function identifier(value: unknown, maximum = 512): asserts value is string {
  text(value, maximum);
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) invalid();
}
function timestamp(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid();
}
export function validateSession(input: unknown): void { exact(input, []); }
export function validateRecord(input: unknown): CloudMessage {
  exact(input, RECORD_KEYS);
  if (typeof input.id !== 'string' || !TOKEN_PATTERN.test(input.id)) invalid('消息标识必须是 64 位小写十六进制字符串。');
  identifier(input.profile); identifier(input.peerId, 256); text(input.peerName, 256, true);
  identifier(input.sourceId); text(input.text, 64000, true); timestamp(input.occurredAt);
  if (input.conversationId !== null) identifier(input.conversationId);
  if (input.direction === 'incoming') {
    if (input.source !== 'incoming' || input.status !== 'received' || input.conversationId === null) invalid();
  } else if (input.direction === 'outgoing') {
    if (typeof input.source !== 'string' || !['auto_reply', 'manual_reply', 'outbound'].includes(input.source) || typeof input.status !== 'string' || !['sent', 'unknown'].includes(input.status)) invalid();
    if (input.source !== 'outbound' && input.conversationId === null) invalid();
  } else invalid();
  return Object.fromEntries(RECORD_KEYS.map(key => [key, input[key]])) as CloudMessage;
}
export function validateBatch(input: unknown): CloudMessage[] {
  exact(input, ['records']);
  if (!Array.isArray(input.records) || input.records.length < 1 || input.records.length > MAX_BATCH_SIZE) invalid('每批必须包含 1 至 50 条消息。');
  const records = input.records.map(validateRecord);
  if (new Set(records.map(record => record.id)).size !== records.length) invalid('同一批消息标识不能重复。');
  return records;
}
export function decodeCursor(value: string | null): ArchiveCursor | null {
  if (value === null) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,240}$/.test(value)) throw new Error();
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    exact(decoded, ['archivedAt', 'id']); timestamp(decoded.archivedAt);
    if (typeof decoded.id !== 'string' || !TOKEN_PATTERN.test(decoded.id)) throw new Error();
    const cursor = decoded as ArchiveCursor;
    if (encodeCursor(cursor) !== value) throw new Error();
    return cursor;
  } catch { throw new ArchiveError('INVALID_CURSOR', '归档分页参数不正确，请重新加载。'); }
}
export function encodeCursor(value: ArchiveCursor) {
  return Buffer.from(JSON.stringify({ archivedAt: value.archivedAt, id: value.id })).toString('base64url');
}
export function validateQuery(parameters: URLSearchParams, allowed: string[]): void {
  for (const key of parameters.keys()) {
    if (!allowed.includes(key) || parameters.getAll(key).length !== 1) throw new ArchiveError('INVALID_QUERY', '归档查询参数不正确。');
  }
}
export function validateAdminFilters(parameters: URLSearchParams): AdminFilters {
  validateQuery(parameters, ['cursor', 'profile', 'peerId', 'from', 'to', 'direction']);
  const filters: AdminFilters = { profile: parameters.get('profile'), peerId: parameters.get('peerId'), from: parameters.get('from'), to: parameters.get('to'), direction: null };
  const direction = parameters.get('direction');
  if (direction !== null && direction !== 'incoming' && direction !== 'outgoing') throw new ArchiveError('INVALID_QUERY', '归档方向筛选不正确。');
  filters.direction = direction;
  try {
    if (filters.profile !== null) identifier(filters.profile);
    if (filters.peerId !== null) identifier(filters.peerId, 256);
    if (filters.from !== null) timestamp(filters.from);
    if (filters.to !== null) timestamp(filters.to);
    if (filters.from !== null && filters.to !== null && filters.from > filters.to) throw new Error();
  } catch { throw new ArchiveError('INVALID_QUERY', '归档筛选条件不正确。'); }
  return filters;
}
export function encodeAdminCursor(value: AdminCursor) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
export function decodeAdminCursor(value: string | null, filterHash: string): AdminCursor | null {
  if (value === null) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,400}$/.test(value)) throw new Error();
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    exact(decoded, ['archivedAt', 'key', 'filterHash']); timestamp(decoded.archivedAt);
    if (typeof decoded.key !== 'string' || !TOKEN_PATTERN.test(decoded.key) || decoded.filterHash !== filterHash || encodeAdminCursor(decoded as AdminCursor) !== value) throw new Error();
    return decoded as AdminCursor;
  } catch { throw new ArchiveError('INVALID_CURSOR', '筛选或分页参数已变化，请重新加载。'); }
}
export function validatePassword(raw: unknown): string {
  exact(raw, ['password']);
  if (typeof raw.password !== 'string' || !raw.password.length || Buffer.byteLength(raw.password, 'utf8') > 72) throw new ArchiveError('UNAUTHORIZED', '管理员密码不正确。', 401);
  return raw.password;
}

export function validateAccountName(raw: unknown): AccountName {
  exact(raw, ['profile', 'displayName']); identifier(raw.profile);
  if (raw.displayName !== null) identifier(raw.displayName, 80);
  return { profile: raw.profile, displayName: raw.displayName as string | null };
}
export function encodeAccountCursor(profileHash: string): string { return Buffer.from(JSON.stringify({ profileHash })).toString('base64url'); }
export function decodeAccountCursor(value: string | null): string | null {
  if (value === null) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error();
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    exact(decoded, ['profileHash']);
    if (typeof decoded.profileHash !== 'string' || !TOKEN_PATTERN.test(decoded.profileHash) || encodeAccountCursor(decoded.profileHash) !== value) throw new Error();
    return decoded.profileHash;
  } catch { throw new ArchiveError('INVALID_CURSOR', '账号分页参数不正确，请重新加载。'); }
}
