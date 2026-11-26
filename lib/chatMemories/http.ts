import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ChatMemoriesError } from './errors';

const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Authorization' };

async function authorize(request: Request) {
  const token = /^Bearer ([A-Za-z0-9_-]{32})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const denied = () => new ChatMemoriesError('UNAUTHORIZED', '请使用聊天手记的访问口令解锁。', 401);
  if (!token) throw denied();
  const digestPath = process.env.CHAT_MEMORIES_KEY_HASH_FILE || '/var/lib/wenwen/chat-memory/key.sha256';
  const digest = (await readFile(digestPath, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid archive key configuration');
  if (!timingSafeEqual(createHash('sha256').update(token).digest(), Buffer.from(digest, 'hex'))) throw denied();
}

export async function privateResponse(request: Request, action: () => object | Promise<object>) {
  try {
    await authorize(request);
    return Response.json({ status: 'ok', ...await action() }, { headers });
  } catch (error) {
    const failure = error instanceof ChatMemoriesError ? error
      : new ChatMemoriesError('ARCHIVE_UNAVAILABLE', '暂时无法读取聊天手记，请稍后再试。', 503);
    return Response.json({ status: 'failed', code: failure.code, error: failure.message }, { status: failure.httpStatus, headers });
  }
}

export async function readQuestion(request: Request): Promise<string> {
  const invalid = () => new ChatMemoriesError('INVALID_INPUT', '请输入 1 至 400 字的问题。', 400);
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw invalid();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw invalid(); }
  if (typeof payload?.question !== 'string') throw invalid();
  const question = payload.question.trim();
  if (!question || Array.from(question).length > 400) throw invalid();
  if (payload.allowModel !== true) {
    throw new ChatMemoriesError('CONSENT_REQUIRED', '提问前请确认将问题、相关片段和统计发送给 DeepSeek。', 400);
  }
  return question;
}

const budget = { active: 0, recent: [] as number[] };
export async function runQuestion<T>(action: () => Promise<T>): Promise<T> {
  const now = Date.now();
  budget.recent = budget.recent.filter(time => now - time < 60_000);
  if (budget.active >= 2 || budget.recent.length >= 8) {
    throw new ChatMemoriesError('RATE_LIMITED', '提问较频繁，请稍后再试。', 429);
  }
  budget.active++;
  budget.recent.push(now);
  try { return await action(); } finally { budget.active--; }
}
