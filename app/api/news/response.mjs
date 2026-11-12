import { NewsReportError } from '../../../lib/newsReports/storage.mjs';

export const newsHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export function newsFailure(error) {
  const known = error instanceof NewsReportError;
  return Response.json({ schemaVersion: 1, status: 'failed',
    code: known ? error.code : 'NEWS_UNAVAILABLE', error: known ? error.message : '日报暂时不可用。' },
  { status: known ? error.httpStatus : 503, headers: newsHeaders });
}
