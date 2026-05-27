import { readdirSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uploadDir = join(process.cwd(), "public", "comics");

export async function GET() {
  try {
    const photos = readdirSync(uploadDir)
      .filter((file) => /\.(webp|png|jpe?g)$/i.test(file))
      .sort();
    return NextResponse.json({ photos });
  } catch {
    return NextResponse.json({ photos: [] });
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("image");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请选择要上传的图片" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "只能上传图片文件" }, { status: 400 });
    }

    await mkdir(uploadDir, { recursive: true });

    const id = randomUUID().slice(0, 8);
    const ext = file.name.split(".").pop()?.toLowerCase() || "webp";
    const filename = `comic-${id}.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    await writeFile(join(uploadDir, filename), bytes);

    return NextResponse.json({ filename, url: `/comics/${filename}` }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "上传失败" }, { status: 500 });
  }
}
