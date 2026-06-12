import { NextResponse } from "next/server";
import { getPublishedStories, logStoriesError } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stories = await getPublishedStories();
    return NextResponse.json({ stories });
  } catch (error) {
    logStoriesError("读取文档列表失败", error);
    return NextResponse.json({ error: "读取文档失败" }, { status: 500 });
  }
}
