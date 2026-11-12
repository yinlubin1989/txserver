import { readReport, publicReport, NewsReportError } from '@/lib/newsReports/storage.mjs';
import { newsFailure, newsHeaders } from '../response.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const report = await readReport(id);
    if (!report) throw new NewsReportError('NEWS_REPORT_NOT_FOUND', '日报不存在。', 404);
    return Response.json({ schemaVersion: 1, status: 'completed', report: publicReport(report) }, { headers: newsHeaders });
  } catch (error) { return newsFailure(error); }
}
