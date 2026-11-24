const SEND_URL = 'https://www.pushplus.plus/send';
const MAX_RESPONSE_BYTES = 1024 * 1024;

export class PushplusTransportError extends Error {
  constructor(code, message, httpStatus = 502, outcome = 'failed', upstreamCode) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.outcome = outcome;
    if (Number.isInteger(upstreamCode)) this.upstreamCode = upstreamCode;
  }
}

export function validatePushplusToken(token) {
  if (typeof token !== 'string' || !token || token.length > 512 || /[\s\u0000-\u001f\u007f]/u.test(token)) {
    throw new PushplusTransportError('PUSHPLUS_NOT_CONFIGURED', 'PushPlus 推送令牌尚未正确配置。', 503);
  }
  return token;
}

async function readResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('EMPTY_RESPONSE');
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('RESPONSE_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function rejection(code) {
  const reasons = {
    900: ['PUSHPLUS_RATE_LIMITED', 'PushPlus 账号调用受限，请在 PushPlus 查看额度后处理。', 429],
    903: ['PUSHPLUS_TOKEN_INVALID', 'PushPlus 推送令牌无效，请重新配置。', 503],
    905: ['PUSHPLUS_VERIFICATION_REQUIRED', '请先在 PushPlus 完成实名认证，再使用推送。', 503],
  };
  const [errorCode, message, httpStatus] = reasons[code] ||
    ['PUSHPLUS_REJECTED', 'PushPlus 拒绝了本次请求，请在 PushPlus 查看账号配置和消息记录。', 502];
  return new PushplusTransportError(errorCode, message, httpStatus, 'failed', code);
}

/** /send code:200 acknowledges receipt only; it never confirms WeChat delivery.
 * https://www.pushplus.plus/doc/guide/api.html
 */
export async function sendPushplus({ token, title = '', text }, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  validatePushplusToken(token);
  if (typeof title !== 'string' || typeof text !== 'string' || !text.trim() || Array.from(text).length > 20000) {
    throw new PushplusTransportError('PUSHPLUS_INVALID_MESSAGE', '推送标题或正文无效，正文最多 20,000 字。', 400);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(SEND_URL, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        // Only the notification preview is shortened; the full original stays in content.
        body: JSON.stringify({ token, title: Array.from(title).slice(0, 100).join(''), content: text, template: 'txt', channel: 'wechat' }),
      });
    } catch {
      throw new PushplusTransportError(controller.signal.aborted ? 'PUSHPLUS_TIMEOUT' : 'PUSHPLUS_NETWORK_ERROR',
        'PushPlus 请求结果未能确认，请勿自动重复发送。', 502, 'unknown');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new PushplusTransportError('PUSHPLUS_HTTP_ERROR', 'PushPlus 未返回成功响应，请勿自动重复发送。', 502, 'unknown');
    }
    let data;
    try { data = await readResponse(response); }
    catch {
      throw new PushplusTransportError(controller.signal.aborted ? 'PUSHPLUS_TIMEOUT' : 'PUSHPLUS_INVALID_RESPONSE',
        'PushPlus 返回结果无法确认，请勿自动重复发送。', 502, 'unknown');
    }
    if (controller.signal.aborted) {
      throw new PushplusTransportError('PUSHPLUS_TIMEOUT', 'PushPlus 请求超时，请勿自动重复发送。', 502, 'unknown');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Number.isInteger(data.code)) {
      throw new PushplusTransportError('PUSHPLUS_INVALID_RESPONSE', 'PushPlus 返回结果缺少明确状态。', 502, 'unknown');
    }
    if (data.code !== 200) throw rejection(data.code);
    if (typeof data.data !== 'string' || !data.data.trim() || data.data.length > 512 || /[\s\u0000-\u001f\u007f]/u.test(data.data)) {
      throw new PushplusTransportError('PUSHPLUS_INVALID_RESPONSE', 'PushPlus 未返回有效消息流水号，请勿自动重复发送。', 502, 'unknown');
    }
    return { status: 'accepted', provider: 'pushplus', channel: 'wechat', providerMessageId: data.data, deliveryStatus: 'pending' };
  } finally { clearTimeout(timer); }
}
