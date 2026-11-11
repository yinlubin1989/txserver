import { completed, handle, ledgerService, readBody } from '@/lib/financeLedger/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return handle(request, 'login', async token =>
    completed({ session: await ledgerService.createWechatSession(await readBody(request), token) }, 201));
}
