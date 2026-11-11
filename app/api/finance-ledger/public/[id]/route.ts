import { completed, handle, ledgerService } from '@/lib/financeLedger/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(request, 'read', async () => completed({ bill: await ledgerService.getPublicBill((await context.params).id) }));
}
