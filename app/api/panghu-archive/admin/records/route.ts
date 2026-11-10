import { adminService, completed, handle } from '@/lib/panghuArchive/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(request, 'admin-read', async token => completed(await adminService.listRecords(token, new URL(request.url).searchParams)));
}
