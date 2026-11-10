import { adminCookie, adminService, assertSameOrigin, completed, handle, readBody } from '@/lib/panghuArchive/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return handle(request, 'admin-login', async () => {
    assertSameOrigin(request);
    const session = await adminService.login(await readBody(request, 1024));
    return completed({ authenticated: true }, 200, { 'Set-Cookie': adminCookie(session.token) });
  });
}
export async function GET(request: Request) {
  return handle(request, 'admin-read', async token => { await adminService.authenticate(token); return completed({ authenticated: true }); });
}
export async function DELETE(request: Request) {
  return handle(request, 'admin-logout', async token => {
    assertSameOrigin(request);
    await adminService.logout(token);
    return completed({ authenticated: false }, 200, { 'Set-Cookie': adminCookie('', true) });
  });
}
