import { isIP } from 'node:net';

export const reportError = code => Object.assign(new Error(code), { code });
const text = (value, max, empty = false) => typeof value === 'string' &&
  (empty || Boolean(value.trim())) && Array.from(value).length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);

/** Only public HTTP(S) document URLs are passed to the provider; local servers are never fetched. */
export function safeSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        (url.port && !['80', '443'].includes(url.port)) || isIP(host) || !host.includes('.') ||
        /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/u.test(host)) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export function sourceUrlsIn(textValue) {
  const urls = [];
  for (const match of textValue.matchAll(/https?:\/\/[^\s<>"'）】]+/gu)) {
    const url = safeSourceUrl(match[0].replace(/[.,;:!?。，；：！？)\]]+$/gu, ''));
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

async function readJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw reportError('REPORT_PROVIDER_INVALID');
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) { await reader.cancel(); throw reportError('REPORT_PROVIDER_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw reportError('REPORT_PROVIDER_INVALID'); }
}

async function request(endpoint, body, { key = process.env.DEEPSEEK_API_KEY, fetchImpl = globalThis.fetch,
  signal, timeoutMs = 20000 } = {}) {
  if (!key) throw reportError('REPORT_AI_NOT_CONFIGURED');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetchImpl(`https://api.deepseek.com${endpoint}`, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      throw reportError(response.status === 402 ? 'REPORT_PROVIDER_BALANCE' : 'REPORT_PROVIDER_FAILED');
    }
    return await readJson(response);
  } catch (error) {
    if (signal?.aborted) throw reportError('REPORT_CANCELLED');
    if (controller.signal.aborted) throw reportError('REPORT_PROVIDER_TIMEOUT');
    if (typeof error.code === 'string' && error.code.startsWith('REPORT_')) throw error;
    throw reportError('REPORT_PROVIDER_FAILED');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function searchWeb(query, options = {}) {
  if (!text(query, 128)) throw reportError('REPORT_QUERY_INVALID');
  const data = await request('/v1/tools/search', { query, count: 5, need_content: true }, options);
  if (!data || !Array.isArray(data.results) || data.results.length > 50) throw reportError('REPORT_SEARCH_INVALID');
  return data.results.map(item => {
    if (!item || !text(item.title, 2000, true) || !text(item.url, 8192) ||
        !text(item.snippet, 10000, true) || !text(item.summary, 20000, true) || !text(item.content, 500000, true) ||
        !(item.site_name === null || text(item.site_name, 1000, true)) ||
        !(item.date === null || (typeof item.date === 'string' && Number.isFinite(Date.parse(item.date)))) ||
        !Number.isInteger(item.authority) || item.authority < -1 || item.authority > 4 ||
        !Number.isFinite(item.rerank_score) || item.rerank_score < 0 || item.rerank_score > 3) throw reportError('REPORT_SEARCH_INVALID');
    const url = safeSourceUrl(item.url);
    return url ? { url, title: item.title, summary: item.summary, content: item.content,
      siteName: item.site_name, publishedAt: item.date, authority: item.authority, score: item.rerank_score } : null;
  }).filter(Boolean);
}

export async function fetchPage(url, options = {}) {
  const safe = safeSourceUrl(url);
  if (!safe) throw reportError('REPORT_SOURCE_INVALID');
  const data = await request('/v1/tools/fetch', { url: safe }, options);
  if (!data || !text(data.title, 2000, true) || !text(data.content, 500000)) throw reportError('REPORT_FETCH_INVALID');
  return { title: data.title, content: data.content };
}

export async function generateStructured({ instructions, input, schema, name, maxOutputTokens = 8000 }, options = {}) {
  const model = options.model || process.env.NEWS_REPORT_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-flash';
  const data = await request('/responses', { model, instructions,
    input: [{ role: 'user', content: JSON.stringify(input) }], reasoning: { effort: 'none' },
    max_output_tokens: maxOutputTokens, tools: [], tool_choice: 'none', stream: false,
    text: { format: { type: 'json_schema', name, schema } },
  }, { timeoutMs: 90000, ...options });
  if (data?.status !== 'completed' || !Array.isArray(data.output)) throw reportError('REPORT_AI_INCOMPLETE');
  const messages = data.output.filter(item => item.type === 'message');
  if (messages.length !== 1 || data.output.some(item => !['message', 'reasoning'].includes(item.type))) throw reportError('REPORT_AI_INVALID');
  const item = messages[0];
  if (item.status !== 'completed' || item.role !== 'assistant' || !Array.isArray(item.content) || !item.content.length ||
      item.content.some(part => part.type !== 'output_text' || typeof part.text !== 'string')) throw reportError('REPORT_AI_INVALID');
  const raw = item.content.map(part => part.text).join('');
  if (raw.length > 100000) throw reportError('REPORT_AI_INVALID');
  try { return JSON.parse(raw); } catch { throw reportError('REPORT_AI_INVALID'); }
}

export function validText(value, max, allowEmpty = false) { return text(value, max, allowEmpty); }
