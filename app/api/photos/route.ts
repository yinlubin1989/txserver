import { readdirSync, createReadStream } from "node:fs";
import { writeFile, mkdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uploadDir = join(process.cwd(), ".local-uploads", "photos");

export async function GET(request: NextRequest) {
  const filename = request.nextUrl.searchParams.get("file");
  
  if (filename) {
    try {
      const filePath = join(uploadDir, filename);
      const stats = await stat(filePath);
      const ext = extname(filename).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".webp": "image/webp",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
      };
      const stream = createReadStream(filePath);
      return new NextResponse(stream as any, {
        headers: {
          "Content-Type": mimeMap[ext] ?? "application/octet-stream",
          "Content-Length": String(stats.size),
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }
  }

  try {
    await mkdir(uploadDir, { recursive: true });
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
    const filename = `photo-${id}.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    await writeFile(join(uploadDir, filename), bytes);

    return NextResponse.json({ filename, url: `/api/photos?file=${filename}` }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "上传失败" }, { status: 500 });
  }
}
