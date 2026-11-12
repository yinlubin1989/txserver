import { randomBytes } from 'node:crypto';

const API_BASE = 'https://ilinkai.weixin.qq.com/ilink/bot/';
const ENDPOINTS = new Set(['getupdates', 'getconfig', 'sendmessage']);
const MAX_RESPONSE_BYTES = 1024 * 1024;

export class WechatTransportError extends Error {
  constructor(code, message, httpStatus = 502, outcome = 'failed', upstream = {}) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.outcome = outcome;
    if (typeof upstream.ret === 'number') this.upstreamRet = upstream.ret;
    if (typeof upstream.errcode === 'number') this.upstreamErrcode = upstream.errcode;
  }
}

/** Reads a bounded response without logging provider bodies or credentials. */
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
  return JSON.parse(Buffer.concat(chunks).toString('utf8'), (key, value, context) => {
    // iLink message_id is uint64. Preserve its wire digits before Number rounding can collide.
    if (key === 'message_id' && typeof value === 'number' && !Number.isSafeInteger(value) &&
        /^[1-9][0-9]{0,19}$/u.test(context?.source || '')) return context.source;
    return value;
  });
}

/** Sending distinguishes an explicit business acknowledgement from an empty HTTP response. */
export async function postWechat(botToken, endpoint, payload, { timeoutMs = 15000, fetchImpl = globalThis.fetch, signal } = {}) {
  if (!ENDPOINTS.has(endpoint)) throw new WechatTransportError('INVALID_ENDPOINT', '微信接口配置无效。', 503);
  if (typeof botToken !== 'string' || !botToken || /[\r\n]/u.test(botToken)) {
    throw new WechatTransportError('CHANNEL_NOT_CONFIGURED', '微信机器人尚未配置。', 503);
  }
  const uncertain = endpoint === 'sendmessage' ? 'unknown' : 'failed';
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = JSON.stringify({ ...payload, base_info: { channel_version: '3.0.1/txserver-1.0.0', bot_agent: 'Txserver/1.0.0' } });
    let response;
    try {
      response = await fetchImpl(API_BASE + endpoint, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {
          'Content-Type': 'application/json', 'AuthorizationType': 'ilink_bot_token',
          Authorization: `Bearer ${botToken}`,
          'X-WECHAT-UIN': Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64'),
          'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': String((3 << 16) | 1),
        }, body,
      });
    } catch {
      throw new WechatTransportError(controller.signal.aborted ? 'WECHAT_TIMEOUT' : 'WECHAT_NETWORK_ERROR',
        '微信请求未能确认，请勿自动重复发送。', 502, uncertain);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new WechatTransportError('WECHAT_HTTP_ERROR', '微信服务未返回成功响应，请勿自动重复发送。', 502, uncertain);
    }
    let data;
    try { data = await readResponse(response); }
    catch {
      throw new WechatTransportError(controller.signal.aborted ? 'WECHAT_TIMEOUT' : 'WECHAT_INVALID_RESPONSE',
        '微信返回结果无法确认，请勿自动重复发送。', 502, uncertain);
    }
    // Tencent's sendMessage test accepts HTTP 200 {} (protobuf default fields omitted).
    // This proves HTTP submission only, not ret:0 or delivery; sendText exposes that distinction.
    // https://github.com/Tencent/openclaw-weixin/blob/main/src/api/api.test.ts
    if (endpoint === 'sendmessage' && data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0) return data;
    // Tencent GetUpdatesResp declares optional ret/errcode; live success omits both protobuf defaults.
    // Keep this allowance scoped to polling, with its complete payload contract, never to sendmessage.
    // https://github.com/Tencent/openclaw-weixin/blob/main/src/api/types.ts
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        (endpoint !== 'getupdates' && data.ret === undefined) ||
        (data.ret !== undefined && !Number.isInteger(data.ret)) ||
        (data.errcode !== undefined && !Number.isInteger(data.errcode))) {
      throw new WechatTransportError('WECHAT_INVALID_RESPONSE', '微信返回结果缺少明确状态。', 502, uncertain);
    }
    if ((data.ret !== undefined && data.ret !== 0) || (data.errcode !== undefined && data.errcode !== 0)) {
      if (data.ret === -14 || data.errcode === -14) {
        throw new WechatTransportError('WECHAT_LOGIN_REQUIRED', '微信机器人登录已失效，请重新绑定。', 409, 'failed', data);
      }
      throw new WechatTransportError('WECHAT_REJECTED', '微信拒绝了本次请求，请检查机器人连接状态后再处理。', 502, 'failed', data);
    }
    if (endpoint === 'getupdates' && (!Array.isArray(data.msgs) || typeof data.get_updates_buf !== 'string')) {
      throw new WechatTransportError('WECHAT_INVALID_RESPONSE', '微信消息轮询结果格式无效。', 502);
    }
    return data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function sendText(credentials, context, text, clientId, options) {
  if (!credentials?.recipient || context?.recipient !== credentials.recipient || !context.contextToken) {
    throw new WechatTransportError('CONTEXT_REQUIRED', '请先在微信里给机器人发一条消息，再重新调用。', 409);
  }
  if (typeof text !== 'string' || !text.trim() || typeof clientId !== 'string' || !clientId) {
    throw new WechatTransportError('INVALID_MESSAGE', '消息内容或请求标识无效。', 400);
  }
  const receipt = await postWechat(credentials.botToken, 'sendmessage', { msg: {
    from_user_id: '', to_user_id: credentials.recipient, client_id: clientId,
    message_type: 2, message_state: 2,
    item_list: [{ type: 1, text_item: { text } }], context_token: context.contextToken,
  } }, options);
  return receipt.ret === 0 ? { status: 'accepted' } :
    { status: 'submitted', deliveryStatus: 'unknown', acknowledgement: 'missing_business_status' };
}
