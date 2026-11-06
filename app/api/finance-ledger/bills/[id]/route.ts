import { completed, handle, ledgerService } from '@/lib/financeLedger/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(request, 'read', async token => completed({ bill: await ledgerService.getBill(token, (await context.params).id) }));
}
