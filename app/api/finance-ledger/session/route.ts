import { completed, handle, ledgerService } from '@/lib/financeLedger/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return handle(request, 'session', async () => completed({ session: await ledgerService.createSession() }, 201));
}
