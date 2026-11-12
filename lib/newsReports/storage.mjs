import { mkdir, open, readdir, rename, unlink, link } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const REPORT_STATES = new Set(['idle', 'queued', 'processing', 'completed', 'partial', 'failed']);
const AUDIO_STATES = new Set(['not_requested', 'pending', 'ready', 'failed']);
const MAX_REPORT_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const PAGE_SIZE = 20;

export class NewsReportError extends Error {
  constructor(code, message, httpStatus = 503) {
    super(message); this.code = code; this.httpStatus = httpStatus;
  }
}
const invalid = () => new NewsReportError('NEWS_REPORT_INVALID', '日报记录格式无效。');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value, max) => typeof value === 'string' && Array.from(value).length <= max;
const isTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

function validateId(id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/u.test(id)) {
    throw new NewsReportError('NEWS_REPORT_ID_INVALID', '日报编号无效。', 400);
  }
}
function validateDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new NewsReportError('NEWS_REPORTS_NOT_CONFIGURED', '日报存储尚未配置。');
  }
  return directory;
}
export function getReportsDirectory() {
  return validateDirectory(process.env.NEWS_REPORTS_DIR || '/root/.txserver-news');
}
function reportPath(id, directory) {
  validateId(id); return path.join(validateDirectory(directory), 'reports', `${id}.json`);
}
function audioPath(id, directory) {
  validateId(id); return path.join(validateDirectory(directory), 'audio', `${id}.mp3`);
}
function triggerPath(id, directory) {
  validateId(id); return path.join(validateDirectory(directory), 'triggers', `${id}.json`);
}
export function getReportsPublicOrigin() {
  try {
    const url = new URL(process.env.NEWS_PUBLIC_ORIGIN || 'https://yinlubin.cn');
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw invalid();
    return url.origin;
  } catch { throw new NewsReportError('NEWS_REPORTS_NOT_CONFIGURED', '日报公开地址尚未配置。'); }
}
function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}
function validateReport(report, expectedId) {
  if (!isObject(report) || report.schemaVersion !== 1 || report.source !== 'grokbot') throw invalid();
  validateId(report.id);
  if (expectedId !== undefined && report.id !== expectedId) throw invalid();
  if (!isText(report.title, 300) || !report.title.trim() || !isDate(report.reportDate) ||
      !isTimestamp(report.createdAt) || !isTimestamp(report.updatedAt) || !REPORT_STATES.has(report.status) ||
      !isObject(report.original) || !isText(report.original.content, 3000) || !report.original.content.trim() ||
      !isText(report.original.time, 80) || !Array.isArray(report.sources) || report.sources.length > 100 ||
      !Array.isArray(report.warnings) || report.warnings.length > 100 || !isObject(report.audio) ||
      !AUDIO_STATES.has(report.audio.status)) throw invalid();
  if (report.audio.status === 'ready' ? report.audio.url !== `/api/news/${report.id}/audio` : report.audio.url !== null) throw invalid();
  if (!(report.audio.text === undefined || report.audio.text === null || isText(report.audio.text, 3000))) throw invalid();
  if (report.status === 'idle' ? report.audio.status !== 'not_requested' || report.body !== null : report.audio.status === 'not_requested') throw invalid();
  if (report.status === 'idle' && report.audio.text != null) throw invalid();
  const sourceIds = new Set();
  for (const source of report.sources) {
    if (!isObject(source) || !isText(source.id, 128) || !source.id || sourceIds.has(source.id) ||
        !isText(source.url, 8192) || !safeSourceUrl(source.url) || !isText(source.title, 1000) ||
        !(source.siteName === null || isText(source.siteName, 500)) ||
        !(source.publishedAt === null || isTimestamp(source.publishedAt))) throw invalid();
    sourceIds.add(source.id);
  }
  const validReferences = ids => Array.isArray(ids) && ids.length <= 100 && ids.every(id => typeof id === 'string' && sourceIds.has(id));
  for (const warning of report.warnings) {
    if (!isObject(warning) || !isText(warning.code, 100) || !warning.code || !isText(warning.message, 2000)) throw invalid();
  }
  if (report.body !== null) {
    const body = report.body;
    if (!isObject(body) || !isText(body.intro, 5000) || !isText(body.voiceScript, 240) ||
        !Array.isArray(body.highlights) || body.highlights.length > 40 || !Array.isArray(body.sections) || body.sections.length > 40) throw invalid();
    for (const highlight of body.highlights) {
      if (!isObject(highlight) || !isText(highlight.text, 5000) || !validReferences(highlight.sourceIds)) throw invalid();
    }
    for (const section of body.sections) {
      if (!isObject(section) || !isText(section.title, 500) || !Array.isArray(section.paragraphs) || section.paragraphs.length > 80) throw invalid();
      for (const paragraph of section.paragraphs) {
        if (!isObject(paragraph) || !isText(paragraph.text, 10000) || !validReferences(paragraph.sourceIds) ||
            !['fact', 'analysis', 'uncertain'].includes(paragraph.kind)) throw invalid();
      }
    }
  }
  return report;
}

async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
/** Creation uses a hard link so an existing manifest is never replaced by a concurrent request. */
async function atomicWrite(file, bytes, { createOnly = false } = {}) {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await syncDirectory(path.dirname(directory));
  const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    if (createOnly) {
      try { await link(temporary, file); }
      catch (error) { if (error.code === 'EEXIST') return false; throw error; }
    } else { await rename(temporary, file); }
    await syncDirectory(directory);
    return true;
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
function reportBytes(report) {
  validateReport(report);
  const bytes = Buffer.from(JSON.stringify(report));
  if (bytes.length > MAX_REPORT_BYTES) throw invalid();
  return bytes;
}

export async function createReport({ id, notification, reportDate, createdAt = new Date().toISOString() }, { directory = getReportsDirectory() } = {}) {
  const file = reportPath(id, directory);
  if (!isObject(notification) || !isText(notification.title ?? '', 120) || !isText(notification.content, 3000) ||
      !notification.content.trim() || !isText(notification.time ?? '', 80)) throw invalid();
  const report = {
    schemaVersion: 1, id, title: (notification.title || '').replace(/^【grokbot】\s*/iu, '').trim() || '每日简报',
    source: 'grokbot', reportDate, createdAt, updatedAt: createdAt, status: 'idle',
    original: { content: notification.content, time: notification.time ?? '' },
    body: null, sources: [], warnings: [], audio: { status: 'not_requested', url: null, text: null },
  };
  const created = await atomicWrite(file, reportBytes(report), { createOnly: true });
  if (created) return report;
  const existing = await readReport(id, { directory });
  if (!existing || existing.original.content !== report.original.content || existing.original.time !== report.original.time ||
      existing.title !== report.title || existing.reportDate !== report.reportDate) {
    throw new NewsReportError('NEWS_REPORT_CONFLICT', '同一日报编号不能保存不同内容。', 409);
  }
  return existing;
}

async function readManifest(file, id) {
  let bytes;
  try {
    const handle = await open(file, 'r');
    try {
      if ((await handle.stat()).size > MAX_REPORT_BYTES) throw invalid();
      bytes = await handle.readFile();
    } finally { await handle.close(); }
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  try { return validateReport(JSON.parse(bytes.toString('utf8')), id); }
  catch (error) { if (error instanceof NewsReportError) throw error; throw invalid(); }
}

export async function readReport(id, { directory = getReportsDirectory() } = {}) {
  // A trigger is also the durable queued manifest: there is no marker-to-queue crash window.
  return await readManifest(triggerPath(id, directory), id) ?? await readManifest(reportPath(id, directory), id);
}

export async function writeReport(report, { directory = getReportsDirectory() } = {}) {
  const trigger = triggerPath(report?.id, directory);
  const triggered = await readManifest(trigger, report.id);
  if (triggered && report.status === 'idle') {
    throw new NewsReportError('NEWS_REPORT_ALREADY_REQUESTED', '日报语音已触发，不能恢复为未请求状态。', 409);
  }
  const file = triggered ? trigger : reportPath(report.id, directory);
  await atomicWrite(file, reportBytes(report));
  return report;
}

/** Only an explicit POST calls this. Existing trigger files are never overwritten by the API. */
export async function queueReportAudio(id, { directory = getReportsDirectory(), now = () => Date.now() } = {}) {
  const report = await readReport(id, { directory });
  if (!report) throw new NewsReportError('NEWS_REPORT_NOT_FOUND', '日报不存在。', 404);
  if (report.status !== 'idle') return report;
  const triggered = { ...report, status: 'queued', updatedAt: new Date(now()).toISOString(), audio: { status: 'pending', url: null, text: null } };
  await atomicWrite(triggerPath(id, directory), reportBytes(triggered), { createOnly: true });
  // Another process may already have advanced the worker; return its state, never the old snapshot.
  const current = await readReport(id, { directory });
  if (!current) throw invalid();
  return current;
}

/** @deprecated Research was removed; old callers must not enqueue paid work. */
export async function queueReportDetails() {
  throw new NewsReportError('NEWS_DETAILS_RETIRED', '详情研究已停用，请使用生成语音功能。', 410);
}

/** Whitelist every public level; research evidence and work checkpoints must never escape. */
export function publicReport(report) {
  validateReport(report);
  return {
    schemaVersion: 1, id: report.id, title: report.title, source: report.source, reportDate: report.reportDate,
    createdAt: report.createdAt, updatedAt: report.updatedAt, status: report.status,
    original: { content: report.original.content, time: report.original.time },
    body: report.body === null ? null : {
      intro: report.body.intro, voiceScript: report.body.voiceScript,
      highlights: report.body.highlights.map(item => ({ text: item.text, sourceIds: [...item.sourceIds] })),
      sections: report.body.sections.map(section => ({ title: section.title,
        paragraphs: section.paragraphs.map(item => ({ text: item.text, sourceIds: [...item.sourceIds], kind: item.kind })) })),
    },
    sources: report.sources.map(item => ({ id: item.id, url: item.url, title: item.title, siteName: item.siteName, publishedAt: item.publishedAt })),
    warnings: report.warnings.map(item => ({ code: item.code, message: item.message })),
    audio: { status: report.audio.status, url: report.audio.url, text: report.audio.text ?? null },
  };
}

export function reportReference(report) {
  validateReport(report);
  return { id: report.id, url: `${getReportsPublicOrigin()}/news/${report.id}`, status: report.status, audioStatus: report.audio.status };
}

async function allReports(directory) {
  const root = path.join(validateDirectory(directory), 'reports');
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const reports = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) continue;
    const report = await readReport(entry.name.slice(0, -5), { directory });
    if (report) reports.push(report);
  }
  return reports;
}

export async function listReports({ page = 1, directory = getReportsDirectory() } = {}) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) {
    throw new NewsReportError('NEWS_PAGE_INVALID', '分页参数无效。', 400);
  }
  const reports = await allReports(directory);
  reports.sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const offset = (page - 1) * PAGE_SIZE;
  return { items: reports.slice(offset, offset + PAGE_SIZE).map(report => ({
    id: report.id, title: report.title, source: report.source, reportDate: report.reportDate,
    createdAt: report.createdAt, updatedAt: report.updatedAt, status: report.status,
    excerpt: Array.from(report.original.content).slice(0, 160).join(''),
    audioStatus: report.audio.status,
  })), page, hasMore: offset + PAGE_SIZE < reports.length };
}

export async function listPendingReports({ directory = getReportsDirectory() } = {}) {
  const reports = await allReports(directory);
  return reports.filter(report => ['queued', 'processing'].includes(report.status))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function validateAudio(buffer) {
  const isMp3 = Buffer.isBuffer(buffer) && buffer.length > 100 && buffer.length <= MAX_AUDIO_BYTES &&
    (buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0));
  if (!isMp3) throw new NewsReportError('NEWS_AUDIO_INVALID', '日报音频格式无效。');
  return buffer;
}
export async function saveAudio(id, buffer, { directory = getReportsDirectory() } = {}) {
  const file = audioPath(id, directory);
  await atomicWrite(file, validateAudio(buffer));
  return `/api/news/${id}/audio`;
}
/** Recovery only: a complete file does not imply the manifest has published it. */
export async function readSavedAudio(id, { directory = getReportsDirectory() } = {}) {
  const file = audioPath(id, directory);
  try {
    const handle = await open(file, 'r');
    try {
      if ((await handle.stat()).size > MAX_AUDIO_BYTES) throw new NewsReportError('NEWS_AUDIO_INVALID', '日报音频格式无效。');
      return validateAudio(await handle.readFile());
    } finally { await handle.close(); }
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
