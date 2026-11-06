import { extractionSchema, FinanceError } from './ledger';
import { SYSTEM_PROMPT } from './prompt';
export async function extractLedger(text: string, signal: AbortSignal) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new FinanceError('NOT_CONFIGURED', '统计服务尚未配置，请稍后再试。', 503);
  const started = Date.now();
  const response = await fetch('https://api.deepseek.com/responses', {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || 'deepseek-flash', instructions: SYSTEM_PROMPT, input: [{ role: 'user', content: text }], reasoning: { effort: 'none' }, max_output_tokens: 16000, text: { format: { type: 'json_schema', name: 'flower_ledger', schema: extractionSchema } } }),
  });
  if (!response.ok) throw new FinanceError('PROVIDER_ERROR', 'AI识别服务暂时不可用，请稍后重试。', 502);
  const body = await response.json();
  if (body.status !== 'completed' || !Array.isArray(body.output)) throw new FinanceError('INCOMPLETE_OUTPUT', 'AI未完整识别账目，请重试或减少单次内容。', 502);
  const messages = body.output.filter((item: { type: string }) => item.type === 'message');
  const parts = messages.flatMap((item: { content: unknown }) => Array.isArray(item.content) ? item.content : []);
  const content = parts.filter((item: { type: string }) => item.type === 'output_text').map((item: { text: string }) => item.text).join('');
  console.info('finance-statistics', { durationMs: Date.now() - started, inputTokens: body.usage?.input_tokens, outputTokens: body.usage?.output_tokens });
  try { return JSON.parse(content); } catch { throw new FinanceError('INVALID_OUTPUT', 'AI返回内容不完整，请重试。', 502); }
}
