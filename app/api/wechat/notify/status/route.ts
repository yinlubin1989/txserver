import { wechatNotify } from '@/lib/wechatNotify/runtime.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return wechatNotify.status(request); }
