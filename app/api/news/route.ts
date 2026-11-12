import { listReports, NewsReportError } from '@/lib/newsReports/storage.mjs';
import { newsFailure, newsHeaders } from './response.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const page = new URL(request.url).searchParams.get('page') ?? '1';
    if (!/^[1-9]\d{0,6}$/.test(page)) throw new NewsReportError('NEWS_PAGE_INVALID', '分页参数无效。', 400);
    return Response.json({ schemaVersion: 1, status: 'completed', ...await listReports({ page: Number(page) }) }, { headers: newsHeaders });
  } catch (error) { return newsFailure(error); }
}
