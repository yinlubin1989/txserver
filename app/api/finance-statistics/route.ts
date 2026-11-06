import { calculateLedger, FinanceError } from '@/lib/financeStatistics/ledger';
import { extractLedger } from '@/lib/financeStatistics/provider';
import { reserveCall } from '@/lib/financeStatistics/limits';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function POST(request: Request) {
  let release: (() => void) | undefined;
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  const timer = setTimeout(abort, 45000);
  try {
    // Bound the actual bytes as well as the declared Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw new FinanceError('INVALID_INPUT', '请粘贴记账文案。', 400);
    const decoder = new TextDecoder(); let body = ''; let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 160000) { await reader.cancel(); throw new FinanceError('INPUT_TOO_LONG', '单次文案不能超过20,000字符。', 413); }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    let payload;
    try { payload = JSON.parse(body); } catch { throw new FinanceError('INVALID_INPUT', '请求格式不正确。', 400); }
    if (!payload || typeof payload.text !== 'string' || !payload.text.trim()) throw new FinanceError('INVALID_INPUT', '请粘贴记账文案。', 400);
    if (payload.text.length > 20000) throw new FinanceError('INPUT_TOO_LONG', '单次文案不能超过20,000字符。', 413);
    if (!process.env.DEEPSEEK_API_KEY) throw new FinanceError('NOT_CONFIGURED', '统计服务尚未配置，请稍后再试。', 503);
    // Only enable after the reverse proxy overwrites this header and direct access is blocked.
    const ip = process.env.FINANCE_TRUST_PROXY === 'true' ? request.headers.get('x-real-ip') || 'shared' : 'shared';
    release = reserveCall(ip);
    const result = calculateLedger(await extractLedger(payload.text, controller.signal), payload.text);
    return Response.json(result, { headers });
  } catch (error) {
    const failure = controller.signal.aborted ? new FinanceError('TIMEOUT', '识别超时，请重试或减少单次内容。', 504) : error instanceof FinanceError ? error : new FinanceError('INTERNAL_ERROR', '统计暂时失败，请稍后重试。', 500);
    console.warn('finance-statistics', { code: failure.code });
    return Response.json({ status: 'failed', code: failure.code, error: failure.message }, { status: failure.httpStatus, headers });
  } finally { clearTimeout(timer); request.signal.removeEventListener('abort', abort); release?.(); }
}
