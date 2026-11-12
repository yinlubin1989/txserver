import { createHash } from 'node:crypto';
import { readReport, writeReport, saveAudio, readSavedAudio } from './storage.mjs';
import { synthesizeNarrationSpeech } from './speech.mjs';

const DURATION_MS = 120000;
const MAX_ATTEMPTS = 2;
export const narrationError = code => Object.assign(new Error(code), { code });
export const narrationErrorCode = error => /^(REPORT_|NEWS_)[A-Z_]+$/u.test(error?.code || '') ? error.code : 'REPORT_NARRATION_FAILED';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const messages = {
  REPORT_NARRATION_EMPTY: '原文中没有可朗读的文字，链接仍可在简报中查看。',
  REPORT_NARRATION_DEADLINE: '语音生成超过处理时限，原始简报仍可阅读。',
  REPORT_NARRATION_ATTEMPTS_EXHAUSTED: '语音生成中断次数达到上限，原始简报仍可阅读。',
  REPORT_NARRATION_STATE_INVALID: '语音任务状态异常，原始简报仍可阅读。',
  REPORT_NARRATION_FAILED: '语音暂时生成失败，原始简报仍可阅读。',
};

/** Do not summarize, rewrite, or enrich the supplied bulletin. URLs alone are omitted from speech. */
export function narrationText(content) {
  if (typeof content !== 'string' || Array.from(content).length > 3000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(content)) throw narrationError('REPORT_NARRATION_INPUT_INVALID');
  const text = content.replace(/https?:\/\/[^\s<>"'()[\]，。；！？、（）【】]+/giu, '').trim();
  if (!/[\p{L}\p{N}]/u.test(text)) throw narrationError('REPORT_NARRATION_EMPTY');
  return text;
}

function validJob(job, report) {
  return job && job.version === 1 && ['pending', 'generating', 'completed', 'failed'].includes(job.speechStatus) &&
    Number.isFinite(job.startedAt) && Number.isFinite(job.deadlineAt) && job.deadlineAt === job.startedAt + DURATION_MS &&
    Number.isSafeInteger(job.attempts) && job.attempts >= 0 && job.attempts <= MAX_ATTEMPTS &&
    typeof report.audio.text === 'string' && Array.from(report.audio.text).length <= 3000 && report.body === null &&
    (job.speechStatus === 'pending' ? job.attempts === 0 : job.attempts > 0) &&
    (job.audioHash === undefined || /^[a-f0-9]{64}$/u.test(job.audioHash));
}

/** The narration queue only calls TTS. It has no model, search, fetch, or WeChat delivery dependency. */
export async function processNarration(id, { directory, signal, now = () => Date.now(),
  read = readReport, write = writeReport, speak = synthesizeNarrationSpeech,
  save = saveAudio, savedAudio = readSavedAudio } = {}) {
  const report = await read(id, { directory });
  if (!report || !['queued', 'processing'].includes(report.status)) return report;
  const checkpoint = async () => { report.updatedAt = new Date(now()).toISOString(); await write(report, { directory }); };
  const fail = async error => {
    const code = narrationErrorCode(error);
    report.status = 'failed'; report.body = null;
    report.audio = { status: 'failed', url: null, text: report.audio.text ?? null };
    if (report.narration) { report.narration.speechStatus = 'failed'; report.narration.lastError = code; }
    report.warnings = [{ code, message: messages[code] || messages.REPORT_NARRATION_FAILED }];
    await checkpoint(); return report;
  };
  if (report.status === 'queued' && report.narration === undefined) {
    const startedAt = now();
    report.narration = { version: 1, speechStatus: 'pending', startedAt, deadlineAt: startedAt + DURATION_MS, attempts: 0 };
    report.body = null; report.warnings = [];
    try { report.audio = { status: 'pending', url: null, text: narrationText(report.original.content) }; }
    catch (error) { return fail(error); }
    report.status = 'processing'; await checkpoint();
  }
  const job = report.narration;
  try {
    if (!validJob(job, report) || report.audio.text !== narrationText(report.original.content)) throw narrationError('REPORT_NARRATION_STATE_INVALID');
  } catch (error) { return fail(error); }
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, Math.max(1, job.deadlineAt - now()));
  const active = () => {
    if (signal?.aborted) throw narrationError('REPORT_NARRATION_CANCELLED');
    if (now() >= job.deadlineAt || controller.signal.aborted) throw narrationError('REPORT_NARRATION_DEADLINE');
  };
  const complete = async () => {
    job.speechStatus = 'completed'; report.status = 'completed';
    report.audio = { status: 'ready', url: `/api/news/${id}/audio`, text: report.audio.text };
    await checkpoint(); return report;
  };
  try {
    if (signal?.aborted) return report;
    if (['generating', 'completed'].includes(job.speechStatus) && job.audioHash) {
      const saved = await savedAudio(id, { directory });
      // The expected digest is committed before saveAudio. An older audio file cannot complete this job.
      if (saved && digest(saved) === job.audioHash) return complete();
    }
    if (['failed', 'completed'].includes(job.speechStatus)) throw narrationError('REPORT_NARRATION_STATE_INVALID');
    active();
    if (job.attempts >= MAX_ATTEMPTS) throw narrationError('REPORT_NARRATION_ATTEMPTS_EXHAUSTED');
    job.attempts++; job.speechStatus = 'generating'; delete job.audioHash;
    await checkpoint(); // A crash consumes this attempt; only interrupted work may use the second attempt.
    active();
    const buffer = await speak(report.audio.text, { signal: controller.signal });
    active();
    job.audioHash = digest(buffer); await checkpoint();
    active(); await save(id, buffer, { directory }); active();
    return complete();
  } catch (error) {
    if (signal?.aborted) return report;
    return fail(now() >= job.deadlineAt || controller.signal.aborted ? narrationError('REPORT_NARRATION_DEADLINE') : error);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
