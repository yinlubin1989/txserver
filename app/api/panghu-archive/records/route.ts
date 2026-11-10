import { archiveService, completed, handle, readBody } from '@/lib/panghuArchive/http';
import { validateQuery } from '@/lib/panghuArchive/validation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return handle(request, 'write', async token => completed(await archiveService.saveRecords(token, await readBody(request))));
}
export async function GET(request: Request) {
  return handle(request, 'read', async token => {
    const parameters = new URL(request.url).searchParams;
    validateQuery(parameters, ['cursor']);
    return completed(await archiveService.listRecords(token, parameters.get('cursor')));
  });
}
