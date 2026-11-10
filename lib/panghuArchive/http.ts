import { isIP } from 'node:net';
import { ArchiveAdminService, ADMIN_COOKIE, ADMIN_SESSION_SECONDS } from './admin';
import { hashToken } from './crypto';
import { ArchiveError, unavailable } from './errors';
import { limitRequest, type RequestKind } from './limits';
import { ArchiveService } from './service';
import { mongoArchiveStorage } from './storage';
import { MAX_BODY_BYTES, TOKEN_PATTERN } from './validation';

export const archiveService = new ArchiveService(mongoArchiveStorage);
export const adminService = new ArchiveAdminService(mongoArchiveStorage);
const responseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export function completed(value: object, status = 200, headers: Record<string, string> = {}) {
  return Response.json({ ok: true, ...value }, { status, headers: { ...responseHeaders, ...headers } });
}
export function adminCookie(token: string, clear = false) {
  return `${ADMIN_COOKIE}=${clear ? '' : token}; Path=/api/panghu-archive/admin; Max-Age=${clear ? 0 : ADMIN_SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}
function cookieToken(request: Request): string | null {
  const matches = (request.headers.get('cookie') ?? '').split(';').map(item => item.trim()).filter(item => item.startsWith(`${ADMIN_COOKIE}=`));
  return matches.length === 1 ? matches[0].slice(ADMIN_COOKIE.length + 1) : null;
}
export function assertSameOrigin(request: Request): void {
  const expected = process.env.PANGHU_ARCHIVE_ADMIN_ORIGIN;
  try {
    if (!expected || new URL(expected).origin !== expected || new URL(expected).protocol !== 'https:') throw new Error();
  } catch { throw unavailable(); }
  if (request.headers.get('origin') !== expected) throw new ArchiveError('FORBIDDEN_ORIGIN', '此操作只允许从管理页面发起。', 403);
}
export async function handle(request: Request, kind: RequestKind, action: (token: string | null) => Promise<Response>) {
  try {
    const authorization = request.headers.get('authorization');
    const token = kind.startsWith('admin-') ? cookieToken(request) : authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
    const rawIp = process.env.PANGHU_ARCHIVE_TRUST_PROXY === 'true' ? request.headers.get('x-real-ip') : null;
    const ip = rawIp && isIP(rawIp) ? rawIp : 'shared';
    limitRequest(ip, kind, token && TOKEN_PATTERN.test(token) ? hashToken(token) : 'anonymous');
    return await action(token);
  } catch (error) {
    const failure = error instanceof ArchiveError ? error : unavailable();
    // Never log tokens, passwords, decrypted messages, or driver errors containing data.
    console.warn('panghu-archive', { code: failure.code });
    return Response.json({ ok: false, code: failure.code, error: failure.message, ...(kind === 'write' ? { acceptedIds: failure.acceptedIds } : {}) }, { status: failure.httpStatus, headers: responseHeaders });
  }
}
export async function readBody(request: Request, maximum = MAX_BODY_BYTES): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ArchiveError('UNSUPPORTED_MEDIA_TYPE', '请求必须使用 application/json。', 415);
  const declared = request.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maximum) throw new ArchiveError('BODY_TOO_LARGE', '归档请求内容过大。', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ArchiveError('INVALID_JSON', '请求体必须是 JSON 对象。');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel().catch(() => undefined); throw new ArchiveError('BODY_TOO_LARGE', '归档请求内容过大。', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as unknown; }
  catch { throw new ArchiveError('INVALID_JSON', '请求体必须是有效 JSON。'); }
}
