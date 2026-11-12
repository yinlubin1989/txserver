import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getStateDirectory, readCredentials, readContext, atomicWriteJson } from './channel.mjs';
import { sendText, WechatTransportError } from './transport.mjs';

const responseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export class NotifyError extends Error {
  constructor(code, message, httpStatus = 400, outcome = 'failed') {
    super(message); this.code = code; this.httpStatus = httpStatus; this.outcome = outcome;
  }
}
function reply(value, httpStatus) {
  return Response.json({ schemaVersion: 1, ...value }, { status: httpStatus, headers: responseHeaders });
}
function failure(error) {
  return error instanceof NotifyError || error instanceof WechatTransportError ? error :
    new NotifyError('NOTIFY_UNAVAILABLE', '通知服务暂时不可用。', 503);
}
function failureBody(error, requestId) {
  return { status: error.outcome, code: error.code, error: error.message, ...(requestId ? { requestId } : {}),
    ...(Number.isInteger(error.upstreamRet) ? { upstreamRet: error.upstreamRet } : {}),
    ...(Number.isInteger(error.upstreamErrcode) ? { upstreamErrcode: error.upstreamErrcode } : {}) };
}
export function authenticate(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new NotifyError('NOT_CONFIGURED', '通知接口尚未配置。', 503);
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const hash = value => createHash('sha256').update(value).digest();
  if (!token || !timingSafeEqual(hash(token), hash(secret))) throw new NotifyError('UNAUTHORIZED', '通知接口凭证无效。', 401);
}
export function parseNotification(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NotifyError('INVALID_INPUT', '请提供 JSON 对象。');
  const allowed = ['title', 'content', 'type', 'time'];
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new NotifyError('INVALID_INPUT', '仅支持 title、content、type、time 字段。');
  const limits = { title: 120, content: 3000, type: 40, time: 80 };
  const result = {};
  for (const [key, limit] of Object.entries(limits)) {
    const field = value[key];
    if (field === undefined && key !== 'content') { result[key] = ''; continue; }
    if (typeof field !== 'string' || Array.from(field).length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(field)) {
      throw new NotifyError('INVALID_INPUT', `${key} 必须是长度不超过 ${limit} 的文字。`);
    }
    result[key] = field.trim();
  }
  if (!result.content) throw new NotifyError('INVALID_INPUT', 'content 不能为空。');
  const heading = [result.type ? `【${result.type}】` : '', result.title].filter(Boolean).join(' ');
  const text = [heading, result.content, result.time ? `时间：${result.time}` : ''].filter(Boolean).join('\n\n');
  if (Buffer.byteLength(text, 'utf8') > 10000) throw new NotifyError('INVALID_INPUT', '消息总长度不能超过 10,000 字节。');
  return { text, hash: createHash('sha256').update(JSON.stringify(result)).digest('hex') };
}
async function readBody(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new NotifyError('UNSUPPORTED_MEDIA_TYPE', '请使用 application/json。', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new NotifyError('INVALID_JSON', '请求正文不能为空。');
  let bytes = 0, timedOut = false; const chunks = [];
  const timer = setTimeout(() => { timedOut = true; reader.cancel().catch(() => {}); }, 10000);
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 16384) { await reader.cancel(); throw new NotifyError('BODY_TOO_LARGE', '请求正文不能超过 16 KB。', 413); }
      chunks.push(value);
    }
  } finally { clearTimeout(timer); reader.releaseLock(); }
  if (timedOut) throw new NotifyError('REQUEST_TIMEOUT', '读取请求超时，请重试。', 408);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new NotifyError('INVALID_JSON', '请求正文不是有效 JSON。'); }
}

export function createNotifyService({
  directory = getStateDirectory(), secret = () => process.env.WECHAT_NOTIFY_API_KEY,
  send = sendText, credentials = readCredentials, context = readContext, now = () => Date.now(),
  writeJournal = atomicWriteJson,
} = {}) {
  let active = false;
  let minute = 0, minuteCount = 0, day = '', dayCount = 0;
  function limit() {
    const current = now();
    const m = Math.floor(current / 60000), d = new Date(current + 8 * 3600000).toISOString().slice(0, 10);
    if (m !== minute) { minute = m; minuteCount = 0; }
    if (d !== day) { day = d; dayCount = 0; }
    if (minuteCount >= 10 || dayCount >= 100) throw new NotifyError('RATE_LIMITED', '通知调用过于频繁，请稍后重试。', 429);
    minuteCount++; dayCount++;
  }
  async function notify(request) {
    let reserved = false, ownsActive = false, requestId, file, fingerprint;
    try {
      authenticate(request, secret());
      const parsed = parseNotification(await readBody(request)); fingerprint = parsed.hash;
      const key = request.headers.get('idempotency-key') ?? randomUUID();
      if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) throw new NotifyError('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key 需为 1–128 位字母、数字或 _ . : -。');
      requestId = createHash('sha256').update(key).digest('hex');
      const journal = path.join(directory, 'requests');
      file = `${requestId}.json`;
      await mkdir(journal, { recursive: true, mode: 0o700 });
      const parentHandle = await open(directory, 'r');
      try { await parentHandle.sync(); } finally { await parentHandle.close(); }
      try {
        const previous = JSON.parse(await readFile(path.join(journal, file), 'utf8'));
        if (previous.hash !== fingerprint) throw new NotifyError('IDEMPOTENCY_CONFLICT', '同一 Idempotency-Key 不能用于不同内容。', 409);
        if (previous.state === 'finished') return reply({ ...previous.body, deduplicated: true }, previous.httpStatus);
        throw new NotifyError('SEND_UNCONFIRMED', '此请求正在发送或上次发送结果未知，不会重复发送。', 409, 'unknown');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (active) throw new NotifyError('BUSY', '已有通知正在发送，请稍后重试。', 429);
      active = true; ownsActive = true;
      const account = await credentials(directory);
      const session = await context(directory);
      if (session.recipient !== account.recipient || !session.contextToken) throw new NotifyError('CONTEXT_REQUIRED', '请先在微信里给机器人发一条消息，再重新调用。', 409);
      limit();
      try {
        const handle = await open(path.join(journal, file), 'wx', 0o600);
        reserved = true;
        try { await handle.writeFile(JSON.stringify({ state: 'pending', hash: fingerprint, createdAt: new Date(now()).toISOString() })); await handle.sync(); }
        finally { await handle.close(); }
      } catch (error) {
        if (error.code === 'EEXIST') throw new NotifyError('SEND_UNCONFIRMED', '此请求已由另一个调用接收，不会重复发送。', 409, 'unknown');
        throw error;
      }
      const journalHandle = await open(journal, 'r');
      try { await journalHandle.sync(); } finally { await journalHandle.close(); }
      await send(account, session, parsed.text, `txserver-${requestId}`);
      const body = { status: 'accepted', requestId, acceptedAt: new Date(now()).toISOString(), deduplicated: false };
      await writeJournal(journal, file, { state: 'finished', hash: fingerprint, body, httpStatus: 202 });
      return reply(body, 202);
    } catch (error) {
      let problem = failure(error);
      // Once reserved, any unexpected local failure may have followed an upstream send.
      if (reserved && !(error instanceof NotifyError) && !(error instanceof WechatTransportError)) problem = new NotifyError('SEND_UNCONFIRMED', '发送结果未能确认，请先查看微信，勿自动重发。', 502, 'unknown');
      const body = failureBody(problem, requestId);
      if (reserved) {
        try { await writeJournal(path.join(directory, 'requests'), file, { state: 'finished', hash: fingerprint, body, httpStatus: problem.httpStatus }); }
        catch { /* A pending journal intentionally prevents re-sending after storage failure. */ }
      }
      console.warn('wechat-notify', { code: problem.code });
      return reply(body, problem.httpStatus);
    } finally { if (ownsActive) active = false; }
  }
  async function status(request) {
    try {
      authenticate(request, secret());
      const account = await credentials(directory);
      const session = await context(directory);
      let health = null;
      try { health = JSON.parse(await readFile(path.join(directory, 'health.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      return reply({ status: 'completed', channel: 'weixin-ilink',
        contextAvailable: account.recipient === session.recipient && Boolean(session.contextToken),
        listener: health ? { status: health.status, code: health.code, checkedAt: health.checkedAt } : null,
        note: '连接状态不代表消息已送达；发送结果以 POST 返回为准。' }, 200);
    } catch (error) { const problem = failure(error); return reply(failureBody(problem), problem.httpStatus); }
  }
  return { notify, status };
}
