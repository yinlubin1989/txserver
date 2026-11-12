import { wechatNotify } from '@/lib/wechatNotify/runtime.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await context.params;
  return wechatNotify.requestStatus(request, requestId);
}
