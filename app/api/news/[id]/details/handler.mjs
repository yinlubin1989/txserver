import { NewsReportError } from '../../../../../lib/newsReports/storage.mjs';
import { newsFailure } from '../../response.mjs';

/** Explicitly retire the old paid research endpoint, including stale browser clients. */
export function detailsResponse() {
  return newsFailure(new NewsReportError('NEWS_DETAILS_RETIRED', '详情研究已停用，请刷新页面后使用生成语音功能。', 410));
}
