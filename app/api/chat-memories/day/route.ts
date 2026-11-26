import { getDay, isArchiveDay } from '@/lib/chatMemories/archive';
import { ChatMemoriesError } from '@/lib/chatMemories/errors';
import { privateResponse } from '@/lib/chatMemories/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return privateResponse(request, () => {
    const params = new URL(request.url).searchParams;
    const day = params.get('day');
    if (day === null || !isArchiveDay(day)) throw new ChatMemoriesError('INVALID_DATE', '日期格式应为 YYYY-MM-DD。', 400);
    const rawCursor = params.get('cursor');
    if (rawCursor !== null && (!/^-?(?:0|[1-9]\d*)$/.test(rawCursor) || !Number.isSafeInteger(Number(rawCursor)))) {
      throw new ChatMemoriesError('INVALID_CURSOR', '翻页位置无效，请重新打开手记。', 400);
    }
    return getDay(day, rawCursor === null ? null : Number(rawCursor));
  });
}
