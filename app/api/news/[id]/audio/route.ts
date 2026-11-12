import { audioResponse } from './handler.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return audioResponse(request, id);
}
export async function HEAD(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return audioResponse(request, id);
}
