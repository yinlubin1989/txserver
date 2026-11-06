import { completed, handle, ledgerService, readBody } from '@/lib/financeLedger/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(request, 'read', async token => completed({ bill: await ledgerService.getBill(token, (await context.params).id) }));
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(request, 'write', async token => completed({ bill: await ledgerService.setVisibility(token, (await context.params).id, await readBody(request)) }));
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(request, 'write', async token => completed({ bill: await ledgerService.deleteBill(token, (await context.params).id) }));
}
