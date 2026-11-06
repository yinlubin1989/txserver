import { completed, handle, ledgerService, readBody } from '@/lib/financeLedger/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return handle(request, 'write', async token => {
    const result = await ledgerService.saveBill(token, await readBody(request));
    return completed({ bill: result.bill }, result.created ? 201 : 200);
  });
}
export async function GET(request: Request) {
  return handle(request, 'read', async token => completed(await ledgerService.listBills(token, new URL(request.url).searchParams.get('cursor'))));
}
