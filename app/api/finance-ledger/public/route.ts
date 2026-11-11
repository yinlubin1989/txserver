import { completed, handle, ledgerService } from '@/lib/financeLedger/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(request, 'read', async () => completed(await ledgerService.listPublicBills(new URL(request.url).searchParams.get('cursor'))));
}
