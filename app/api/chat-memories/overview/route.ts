import { getOverview } from '@/lib/chatMemories/archive';
import { privateResponse } from '@/lib/chatMemories/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return privateResponse(request, () => getOverview());
}
