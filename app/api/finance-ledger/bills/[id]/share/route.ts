import { completed, handle, ledgerService } from '@/lib/financeLedger/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(request, 'write', async token => completed({ share: await ledgerService.shareBill(token, (await context.params).id) }));
}
