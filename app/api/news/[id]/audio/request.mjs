import { queueReportAudio, publicReport, getReportsPublicOrigin, NewsReportError } from '../../../../../lib/newsReports/storage.mjs';
import { newsFailure, newsHeaders } from '../../response.mjs';

function verifyOrigin(request, expectedOrigin) {
  const site = request.headers.get('sec-fetch-site');
  const origin = request.headers.get('origin');
  const url = new URL(request.url);
  const localDevelopment = process.env.NODE_ENV === 'development' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && origin === url.origin;
  if ((site && !['same-origin', 'none'].includes(site)) || (origin !== null && origin !== expectedOrigin && !localDevelopment)) {
    throw new NewsReportError('NEWS_AUDIO_ORIGIN_REJECTED', '请在日报页面中生成语音。', 403);
  }
}

async function verifyEmptyBody(request) {
  if (request.body === null) return;
  const reader = request.body.getReader();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; reader.cancel().catch(() => {}); }, 2000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.byteLength > 0) {
        await reader.cancel().catch(() => {});
        throw new NewsReportError('NEWS_AUDIO_BODY_NOT_ALLOWED', '生成语音不接受正文或外部链接。', 400);
      }
    }
  } finally { clearTimeout(timer); reader.releaseLock(); }
  if (timedOut) throw new NewsReportError('NEWS_AUDIO_REQUEST_TIMEOUT', '读取请求超时，请重试。', 408);
}

export async function requestAudioResponse(request, id, { directory, expectedOrigin } = {}) {
  try {
    verifyOrigin(request, expectedOrigin ?? getReportsPublicOrigin());
    // Next may expose an empty stream even when fetch sent no body; inspect bytes, not its presence.
    await verifyEmptyBody(request);
    const report = await queueReportAudio(id, { directory });
    return Response.json({ schemaVersion: 1, status: 'completed', report: publicReport(report) }, { headers: newsHeaders });
  } catch (error) { return newsFailure(error); }
}
