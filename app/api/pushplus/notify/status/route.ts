import { pushplusNotify } from '@/lib/wechatNotify/pushplus/runtime.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return pushplusNotify.status(request); }
