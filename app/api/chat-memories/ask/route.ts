import { privateResponse, readQuestion, runQuestion } from '@/lib/chatMemories/http';
import { askQuestion } from '@/lib/chatMemories/question';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return privateResponse(request, async () => {
    const question = await readQuestion(request);
    return runQuestion(() => askQuestion(question, request.signal));
  });
}
