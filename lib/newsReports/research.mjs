import { createHash } from 'node:crypto';
import { readReport, writeReport, saveAudio, readSavedAudio, reportReference } from './storage.mjs';
import { searchWeb, fetchPage, sourceUrlsIn, reportError } from './provider.mjs';
import { planResearch, composeReport } from './researchContent.mjs';
import { synthesizeReportSpeech } from './speech.mjs';

const MAX_SEARCHES = 6, MAX_FETCHES = 10, MAX_DURATION_MS = 300000;
const MAX_ATTEMPTS = { plan: 2, compose: 2, speech: 2, search: MAX_SEARCHES, fetch: MAX_FETCHES };
const STAGES = new Set(['plan', 'search', 'fetch', 'compose', 'speech', 'done']);
const short = (value, limit) => Array.from(value).slice(0, limit).join('');
export const researchErrorCode = error => /^(REPORT_|NEWS_)[A-Z_]+$/u.test(error?.code || '') ? error.code : 'REPORT_RESEARCH_FAILED';

const WARNINGS = {
  REPORT_PLAN_FAILED: '未能完整规划本期联网检索，已保留原始日报。',
  REPORT_SEARCH_FAILED: '部分联网搜索未完成，相关信息可能缺少交叉核实。',
  REPORT_FETCH_FAILED: '部分来源页面无法读取，未将其内容作为已核实资料。',
  REPORT_NO_EVIDENCE: '未取得可用的外部资料，本页仅整理推送原文，未经外部核实。',
  REPORT_RESEARCH_INTERRUPTED: '后台处理曾中断，部分检索未能完成；已保留取得的资料。',
  REPORT_DEADLINE: '本期资料整理超过处理时限，已保留原文和完成的内容。',
  REPORT_BUDGET_EXHAUSTED: '本期资料整理达到调用上限，已保留原文和完成的内容。',
  REPORT_BODY_FAILED: '完整日报整理失败，原始日报仍可阅读。',
  REPORT_SPEECH_FAILED: '语音摘要暂时不可用，正文可正常阅读。',
  REPORT_RESEARCH_FAILED: '日报补充资料暂时失败，原始日报仍可阅读。',
};
function warn(report, code, message = WARNINGS[code] || WARNINGS.REPORT_RESEARCH_FAILED) {
  if (!report.warnings.some(item => item.code === code && item.message === message)) report.warnings.push({ code, message });
}
function validateWork(work, report) {
  if (!work || work.version !== 1 || !STAGES.has(work.stage) || !Number.isFinite(work.deadlineAt) ||
      !Number.isFinite(work.startedAt) || work.deadlineAt <= work.startedAt || work.deadlineAt > work.startedAt + MAX_DURATION_MS ||
      !['pending', 'completed'].includes(work.bodyStatus) || !work.calls || !Array.isArray(work.queries) || !Array.isArray(work.results) ||
      !Array.isArray(work.candidates) || !Array.isArray(work.evidence) ||
      !Number.isSafeInteger(work.searchIndex) || !Number.isSafeInteger(work.fetchIndex) ||
      Object.keys(MAX_ATTEMPTS).some(key => !Number.isSafeInteger(work.calls[key]) || work.calls[key] < 0 || work.calls[key] > MAX_ATTEMPTS[key])) {
    throw reportError('REPORT_WORK_INVALID');
  }
  // A populated body cannot promote a pending checkpoint to completed after a restart.
  if ((work.bodyStatus === 'pending' && report.body !== null) ||
      (work.bodyStatus === 'completed' && report.body === null) ||
      (['speech', 'done'].includes(work.stage) !== (work.bodyStatus === 'completed')) ||
      (work.stage === 'done' && report.audio.status === 'pending') ||
      (work.inFlight !== null && (!work.inFlight || !Object.hasOwn(MAX_ATTEMPTS, work.inFlight.kind)))) {
    throw reportError('REPORT_WORK_INVALID');
  }
}

/** Research owns only report manifests; it never reads or writes WeChat send journals. */
export async function processReport(id, { directory, signal, now = () => Date.now(),
  read = readReport, write = writeReport, plan = planResearch, search = searchWeb, fetch = fetchPage,
  compose = composeReport, speak = synthesizeReportSpeech, save = saveAudio, savedAudio = readSavedAudio } = {}) {
  const report = await read(id, { directory });
  if (!report || !['queued', 'processing'].includes(report.status)) return report;
  const checkpoint = async () => { report.updatedAt = new Date(now()).toISOString(); await write(report, { directory }); };
  if (report.status === 'queued' && report.work === undefined) {
    const startedAt = now();
    report.work = { version: 1, stage: 'plan', bodyStatus: 'pending', startedAt, deadlineAt: startedAt + MAX_DURATION_MS,
      calls: { plan: 0, compose: 0, speech: 0, search: 0, fetch: 0 }, queries: [], results: [],
      candidates: [], evidence: [], searchIndex: 0, fetchIndex: 0, inFlight: null };
    report.sources = [{ id: 'report-original', url: `${reportReference(report).url}#original`, title: '原始日报',
      siteName: 'grokbot', publishedAt: report.createdAt }];
    report.status = 'processing'; await checkpoint();
  }
  const work = report.work;
  try { validateWork(work, report); }
  catch (error) {
    report.status = 'failed'; report.audio = { status: 'failed', url: null };
    warn(report, researchErrorCode(error)); await checkpoint(); return report;
  }
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, Math.max(1, work.deadlineAt - now()));
  const ensureActive = () => {
    if (signal?.aborted) throw reportError('REPORT_CANCELLED');
    if (now() >= work.deadlineAt || controller.signal.aborted) throw reportError('REPORT_DEADLINE');
  };
  const reserve = async (kind, detail) => {
    ensureActive();
    if (work.calls[kind] >= MAX_ATTEMPTS[kind]) throw reportError('REPORT_BUDGET_EXHAUSTED');
    work.calls[kind]++;
    work.inFlight = { kind, detail };
    await checkpoint(); // Count before the external call, including attempts interrupted by process death.
  };
  const finishCall = async () => { work.inFlight = null; await checkpoint(); };
  const onFailure = (error, code) => {
    ensureActive();
    warn(report, code);
    work.lastError = researchErrorCode(error);
  };
  const addEvidence = (candidate, page) => {
    if (!page.content.trim()) return;
    const sourceId = `source-${createHash('sha256').update(candidate.url).digest('hex').slice(0, 16)}`;
    if (report.sources.some(source => source.id === sourceId)) return;
    report.sources.push({ id: sourceId, url: candidate.url, title: short(page.title || candidate.title || candidate.url, 500),
      siteName: short(candidate.siteName || new URL(candidate.url).hostname, 500), publishedAt: candidate.publishedAt || null });
    work.evidence.push({ sourceId, content: short(page.content, 8000), excerpted: Array.from(page.content).length > 8000 });
  };
  try {
    if (work.inFlight?.kind === 'speech') {
      const buffer = await savedAudio(id, { directory });
      if (buffer) {
        report.audio = { status: 'ready', url: `/api/news/${id}/audio` };
        work.stage = 'done'; work.inFlight = null; await checkpoint();
      }
    }
    if (work.inFlight) {
      warn(report, 'REPORT_RESEARCH_INTERRUPTED');
      work.inFlight = null; await checkpoint();
    }
    if (work.stage === 'plan') {
      await reserve('plan', 'queries');
      try { const queries = await plan(report, { signal: controller.signal }); ensureActive(); work.queries = queries; }
      catch (error) { onFailure(error, 'REPORT_PLAN_FAILED'); work.queries = []; }
      work.stage = 'search'; await finishCall();
    }
    if (work.stage === 'search') {
      while (work.searchIndex < work.queries.length) {
        ensureActive();
        const query = work.queries[work.searchIndex]; work.searchIndex++;
        await reserve('search', query);
        try {
          const results = await search(query, { signal: controller.signal });
          ensureActive();
          work.results.push(...results.slice(0, 5).map((item, rank) => ({ ...item, rank, queryIndex: work.searchIndex - 1,
            title: short(item.title, 500), summary: short(item.summary, 3000), content: short(item.content, 8000) })));
        } catch (error) { onFailure(error, 'REPORT_SEARCH_FAILED'); }
        await finishCall();
      }
      const existing = new Map(work.results.map(result => [result.url, result]));
      const original = sourceUrlsIn(report.original.content).slice(0, 6).map(url => existing.get(url) || { url });
      // Interleave ranked results so one event does not consume the entire reading budget.
      const results = [...work.results].sort((a, b) => a.rank - b.rank || b.authority - a.authority || b.score - a.score);
      work.candidates = [...new Map([...original, ...results].map(item => [item.url, item])).values()].slice(0, MAX_FETCHES);
      work.stage = 'fetch'; await checkpoint();
    }
    if (work.stage === 'fetch') {
      while (work.fetchIndex < work.candidates.length) {
        ensureActive();
        const candidate = work.candidates[work.fetchIndex];
        if (candidate.content?.trim()) {
          addEvidence(candidate, candidate); work.fetchIndex++; await checkpoint(); continue;
        }
        work.fetchIndex++;
        await reserve('fetch', candidate.url);
        try { const page = await fetch(candidate.url, { signal: controller.signal }); ensureActive(); addEvidence(candidate, page); }
        catch (error) { onFailure(error, 'REPORT_FETCH_FAILED'); }
        await finishCall();
      }
      if (!work.evidence.length) warn(report, 'REPORT_NO_EVIDENCE');
      work.stage = 'compose'; await checkpoint();
    }
    if (work.stage === 'compose') {
      await reserve('compose', 'report');
      try {
        const result = await compose(report, work.evidence, { signal: controller.signal });
        ensureActive();
        report.body = result.body;
        for (const note of result.notes) warn(report, 'REPORT_EDITOR_NOTE', note);
        work.bodyStatus = 'completed'; work.stage = 'speech';
      } catch (error) { onFailure(error, 'REPORT_BODY_FAILED'); throw error; }
      await finishCall(); // Publish readable text before speech generation.
    }
    if (work.stage === 'speech') {
      const existing = await savedAudio(id, { directory });
      if (!existing) {
        await reserve('speech', 'summary');
        try {
          const buffer = await speak(report.body.voiceScript, { signal: controller.signal });
          ensureActive();
          await save(id, buffer, { directory });
          report.audio = { status: 'ready', url: `/api/news/${id}/audio` };
        } catch (error) {
          onFailure(error, 'REPORT_SPEECH_FAILED'); report.audio = { status: 'failed', url: null };
        }
      } else { report.audio = { status: 'ready', url: `/api/news/${id}/audio` }; }
      work.stage = 'done'; await finishCall();
    }
    report.status = report.warnings.length || report.audio.status !== 'ready' ? 'partial' : 'completed';
  } catch (error) {
    if (signal?.aborted) return report; // Checkpoints survive a graceful restart without resetting the deadline.
    const code = now() >= work.deadlineAt || controller.signal.aborted ? 'REPORT_DEADLINE' : researchErrorCode(error);
    warn(report, code);
    report.status = work.bodyStatus === 'completed' ? 'partial' : 'failed';
    if (report.audio.status !== 'ready') report.audio = { status: 'failed', url: null };
    work.lastError = code; work.stage = 'done'; work.inFlight = null;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  // Keep budgets and stage metadata, not third-party page copies, after processing finishes.
  work.results = []; work.evidence = []; work.candidates = [];
  await checkpoint();
  return report;
}
