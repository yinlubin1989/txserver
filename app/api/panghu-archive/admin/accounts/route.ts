import { adminService, assertSameOrigin, completed, handle, readBody } from '@/lib/panghuArchive/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(request, 'admin-read', async token => completed(await adminService.listAccounts(token, new URL(request.url).searchParams)));
}
export async function PUT(request: Request) {
  return handle(request, 'admin-write', async token => {
    assertSameOrigin(request);
    await adminService.authenticate(token);
    return completed({ account: await adminService.setAccountName(token, await readBody(request, 2048)) });
  });
}
