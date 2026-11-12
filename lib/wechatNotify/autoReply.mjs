import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson } from './channel.mjs';
import { sendText } from './transport.mjs';

const PROMPT = '你是个人微信聊天助手。用简洁自然的中文回应当前这条消息，尽量在300字内。你没有历史会话、联网、工具或执行命令的能力，不能操作服务器、文件、账单或发送其他消息，不要声称已执行操作。对不确定的事实明确说明，不编造。只输出给用户的完整回复正文。';
const issue = code => Object.assign(new Error(code), { code });

async function readJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw issue('AI_INVALID_RESPONSE');
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) { await reader.cancel(); throw issue('AI_INVALID_RESPONSE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw issue('AI_INVALID_RESPONSE'); }
}

/** Same stateless Responses API and environment key as finance extraction; no tools or history. */
export async function generateReply(text, { fetchImpl = globalThis.fetch, key = process.env.DEEPSEEK_API_KEY,
  model = process.env.DEEPSEEK_MODEL || 'deepseek-flash', signal, timeoutMs = 25000 } = {}) {
  if (!key) throw issue('AI_NOT_CONFIGURED');
  if (typeof text !== 'string' || !text.trim() || Array.from(text).length > 6000) throw issue('AI_INPUT_INVALID');
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetchImpl('https://api.deepseek.com/responses', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, instructions: PROMPT, input: [{ role: 'user', content: text }],
        reasoning: { effort: 'none' }, max_output_tokens: 600, tools: [], tool_choice: 'none', stream: false }),
    });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw issue('AI_PROVIDER_ERROR'); }
    const data = await readJson(response);
    if (data?.status !== 'completed' || !Array.isArray(data.output) || data.output.length !== 1) throw issue('AI_INCOMPLETE_RESPONSE');
    const item = data.output[0];
    if (item?.type !== 'message' || item.status !== 'completed' || item.role !== 'assistant' ||
        !Array.isArray(item.content) || !item.content.length ||
        item.content.some(part => part?.type !== 'output_text' || typeof part.text !== 'string')) throw issue('AI_INVALID_RESPONSE');
    const reply = item.content.map(part => part.text).join('').trim();
    if (!reply || Array.from(reply).length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(reply)) throw issue('AI_INVALID_RESPONSE');
    return reply;
  } catch (error) {
    if (controller.signal.aborted) throw issue('AI_TIMEOUT');
    if (typeof error.code === 'string' && error.code.startsWith('AI_')) throw error;
    throw issue('AI_PROVIDER_ERROR');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export function selectIncoming(message, recipient, startedAt, now) {
  if (message?.from_user_id !== recipient || message.message_type !== 1) return null;
  if (!Number.isSafeInteger(message.create_time_ms) || message.create_time_ms < startedAt || message.create_time_ms > now + 300000) {
    throw issue('AUTO_REPLY_OLD_OR_UNTIMED');
  }
  let id;
  if (message.message_id !== undefined) {
    const value = message.message_id;
    const validNumber = Number.isSafeInteger(value) && value > 0;
    const validString = typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value) && BigInt(value) <= 18446744073709551615n;
    if (!validNumber && !validString) throw issue('AUTO_REPLY_ID_INVALID');
    id = `message:${message.message_id}`;
  } else if (typeof message.client_id === 'string' && message.client_id.length > 0 && message.client_id.length <= 256) {
    id = `client:${message.client_id}`;
  } else { throw issue('AUTO_REPLY_ID_INVALID'); }
  if (!Array.isArray(message.item_list)) return null;
  const parts = message.item_list.filter(part => part?.type === 1);
  if (!parts.length) return null;
  if (parts.some(part => typeof part.text_item?.text !== 'string')) throw issue('AUTO_REPLY_INPUT_INVALID');
  const text = parts.map(part => part.text_item.text).join('\n').trim();
  if (!text || Array.from(text).length > 6000) throw issue('AUTO_REPLY_INPUT_INVALID');
  return { id: createHash('sha256').update(`${recipient}:${id}`).digest('hex'), text };
}

export function createAutoReplier({ directory, startedAt = Date.now(), now = () => Date.now(),
  generate = generateReply, send = sendText, signal } = {}) {
  let active = false, minute = -1, minuteCount = 0, day = '', dayCount = 0;
  function limit() {
    const timestamp = now(), currentMinute = Math.floor(timestamp / 60000);
    const currentDay = new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10);
    if (minute !== currentMinute) { minute = currentMinute; minuteCount = 0; }
    if (day !== currentDay) { day = currentDay; dayCount = 0; }
    if (minuteCount >= 6 || dayCount >= 60) throw issue('AUTO_REPLY_RATE_LIMITED');
    minuteCount++; dayCount++;
  }
  return async (messages, account, context) => {
    if (active || signal?.aborted) return;
    active = true;
    try {
      for (const message of messages) {
        if (signal?.aborted) break;
        let incoming, reserved = false;
        const journal = path.join(directory, 'inbound');
        try {
          incoming = selectIncoming(message, account.recipient, startedAt, now());
          if (!incoming) continue;
          if (context.recipient !== account.recipient || !context.contextToken) throw issue('AUTO_REPLY_CONTEXT_REQUIRED');
          await mkdir(journal, { recursive: true, mode: 0o700 });
          let handle;
          try { handle = await open(path.join(journal, `${incoming.id}.json`), 'wx', 0o600); }
          catch (error) { if (error.code === 'EEXIST') continue; throw error; }
          reserved = true;
          try { await handle.writeFile(JSON.stringify({ state: 'pending', createdAt: new Date(now()).toISOString() })); await handle.sync(); }
          finally { await handle.close(); }
          const parent = await open(journal, 'r');
          try { await parent.sync(); } finally { await parent.close(); }
          limit();
          const text = await generate(incoming.text, { signal });
          if (signal?.aborted) break;
          const receipt = await send(account, context, text, `txserver-reply-${incoming.id}`, { signal });
          if (receipt?.status !== 'accepted' && !(receipt?.status === 'submitted' && receipt.deliveryStatus === 'unknown' &&
              receipt.acknowledgement === 'missing_business_status')) throw issue('AUTO_REPLY_UNCONFIRMED');
          await atomicWriteJson(journal, `${incoming.id}.json`, { state: receipt.status, completedAt: new Date(now()).toISOString(),
            ...(receipt.status === 'submitted' ? { deliveryStatus: 'unknown', acknowledgement: 'missing_business_status' } : {}) });
        } catch (error) {
          const code = /^(AI_|AUTO_REPLY_|WECHAT_)[A-Z_]+$/u.test(error.code || '') ? error.code : 'AUTO_REPLY_UNAVAILABLE';
          console.warn('wechat-auto-reply', { code });
          if (reserved) await atomicWriteJson(journal, `${incoming.id}.json`, { state: 'unconfirmed', code }).catch(() => {});
        }
      }
    } finally { active = false; }
  };
}
