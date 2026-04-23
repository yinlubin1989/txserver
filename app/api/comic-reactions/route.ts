import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import { ComicReaction } from '@/lib/models/ComicReaction';

type ReactionAction = 'like' | 'comment';

function json(data: unknown, init?: ResponseInit) {
  const response = NextResponse.json(data, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function normalizePhoto(value: unknown) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!/^[\w.-]+\.(webp|png|jpe?g|gif|avif)$/i.test(trimmed)) return '';
  return trimmed;
}

function normalizeComment(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 80);
}

export async function GET(request: NextRequest) {
  await connectDB();

  const photos = request.nextUrl.searchParams
    .getAll('photo')
    .map(normalizePhoto)
    .filter(Boolean);

  const query = photos.length > 0 ? { photo: { $in: photos } } : {};
  const reactions = await ComicReaction.find(query).sort({ photo: 1 });

  return json({ reactions });
}

export async function POST(request: NextRequest) {
  await connectDB();

  try {
    const body = await request.json();
    const action = body.action as ReactionAction;
    const photo = normalizePhoto(body.photo);

    if (!photo) {
      return json({ error: '图片参数无效' }, { status: 400 });
    }

    if (action === 'like') {
      const reaction = await ComicReaction.findOneAndUpdate(
        { photo },
        { $inc: { likes: 1 }, $setOnInsert: { comments: [] } },
        { new: true, upsert: true },
      );

      return json({ reaction });
    }

    if (action === 'comment') {
      const text = normalizeComment(body.text);
      if (!text) {
        return json({ error: '留言不能为空' }, { status: 400 });
      }

      const reaction = await ComicReaction.findOneAndUpdate(
        { photo },
        {
          $setOnInsert: { likes: 0 },
          $push: {
            comments: {
              $each: [{ text, createdAt: new Date() }],
              $position: 0,
              $slice: 12,
            },
          },
        },
        { new: true, upsert: true },
      );

      return json({ reaction }, { status: 201 });
    }

    return json({ error: '未知操作' }, { status: 400 });
  } catch {
    return json({ error: '无效的 JSON 数据' }, { status: 400 });
  }
}
