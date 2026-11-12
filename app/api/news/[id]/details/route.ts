import { detailsResponse } from './handler.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST() {
  return detailsResponse();
}
