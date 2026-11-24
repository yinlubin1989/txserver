import { pushplusNotify } from '@/lib/wechatNotify/pushplus/runtime.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return pushplusNotify.notify(request); }
