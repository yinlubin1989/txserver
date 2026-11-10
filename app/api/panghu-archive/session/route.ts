import { archiveService, completed, handle, readBody } from '@/lib/panghuArchive/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return handle(request, 'session', async () => completed({ session: await archiveService.createSession(await readBody(request, 1024)) }, 201));
}
