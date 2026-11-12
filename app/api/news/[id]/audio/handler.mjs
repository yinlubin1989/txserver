import { readReport, readSavedAudio, NewsReportError } from '../../../../../lib/newsReports/storage.mjs';
import { newsFailure } from '../../response.mjs';

function rangeBounds(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null;
  if (first === null) return last > 0 ? { start: Math.max(0, size - last), end: size - 1 } : null;
  if (first >= size || (last !== null && last < first)) return null;
  return { start: first, end: last === null ? size - 1 : Math.min(last, size - 1) };
}

export async function audioResponse(request, id, { directory } = {}) {
  try {
    const report = await readReport(id, { directory });
    if (!report) throw new NewsReportError('NEWS_REPORT_NOT_FOUND', '日报不存在。', 404);
    if (report.audio.status !== 'ready') throw new NewsReportError('NEWS_AUDIO_NOT_READY', '日报音频尚不可用。', 404);
    const audio = await readSavedAudio(id, { directory });
    if (!audio) throw new NewsReportError('NEWS_AUDIO_MISSING', '日报音频文件暂时不可用。');
    const headers = {
      'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Content-Length': String(audio.length),
      'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    };
    const range = request.headers.get('range');
    // A Range header only changes GET; HEAD describes the complete representation.
    if (request.method === 'GET' && range !== null) {
      const bounds = rangeBounds(range, audio.length);
      if (!bounds) return new Response(null, { status: 416,
        headers: { ...headers, 'Content-Range': `bytes */${audio.length}`, 'Content-Length': '0' } });
      const { start, end } = bounds;
      return new Response(new Uint8Array(audio.subarray(start, end + 1)), { status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${audio.length}`, 'Content-Length': String(end - start + 1) } });
    }
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(audio), { status: 200, headers });
  } catch (error) {
    const response = newsFailure(error);
    return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
  }
}
