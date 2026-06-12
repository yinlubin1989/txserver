import { NextResponse } from "next/server";
import { getPublishedStory, logStoriesError } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const story = await getPublishedStory(slug);

    if (!story) {
      return NextResponse.json({ error: "文档不存在" }, { status: 404 });
    }

    return NextResponse.json({ story });
  } catch (error) {
    logStoriesError("读取文档详情失败", error);
    return NextResponse.json({ error: "读取文档失败" }, { status: 500 });
  }
}
