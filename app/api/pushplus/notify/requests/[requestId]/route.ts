import { pushplusNotify } from '@/lib/wechatNotify/pushplus/runtime.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await context.params;
  return pushplusNotify.requestStatus(request, requestId);
}
