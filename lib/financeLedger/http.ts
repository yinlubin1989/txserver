import { LedgerError } from './errors';
import { hashToken, LedgerService } from './service';
import { mongoLedgerStorage } from './storage';
import { limitRequest } from './limits';
import { TOKEN_PATTERN } from './validation';

export const ledgerService = new LedgerService(mongoLedgerStorage);
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export function completed(value: object, status = 200) { return Response.json({ schemaVersion: 1, status: 'completed', ...value }, { status, headers }); }
export async function handle(request: Request, kind: 'session' | 'read' | 'write', action: (token: string | null) => Promise<Response>) {
  try {
    const authorization = request.headers.get('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
    const ip = process.env.FINANCE_TRUST_PROXY === 'true' ? request.headers.get('x-real-ip') || 'shared' : 'shared';
    limitRequest(ip, kind, token && TOKEN_PATTERN.test(token) ? hashToken(token) : 'anonymous');
    return await action(token);
  } catch (error) {
    const failure = error instanceof LedgerError ? error : new LedgerError('LEDGER_UNAVAILABLE', '账本服务暂时不可用，请稍后重试。', 503);
    console.warn('finance-ledger', { code: failure.code });
    return Response.json({ status: 'failed', code: failure.code, error: failure.message }, { status: failure.httpStatus, headers });
  }
}
export async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new LedgerError('INVALID_BILL', '保存内容不能为空。');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) { await reader.cancel(); throw new LedgerError('BODY_TOO_LARGE', '账单内容过大，无法保存。', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new LedgerError('INVALID_JSON', '保存请求格式不正确。'); }
}
