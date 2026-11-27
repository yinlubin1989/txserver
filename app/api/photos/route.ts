import { readdirSync, statSync } from "node:fs";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isListedPhoto, isPhotoName, openPhoto, photoDir as uploadDir } from "@/lib/photos/storage";
import { removeThumbnails } from "@/lib/photos/thumbnail";
import type { PhotosResponse } from "@/lib/photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function originalPhoto(filename: string, headOnly = false) {
  if (!isPhotoName(filename)) return NextResponse.json({ error: "无效的照片名" }, { status: 400 });
  try {
    const { file, stats } = await openPhoto(filename);
    const mimeMap: Record<string, string> = {
      ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg", ".gif": "image/gif",
    };
    const headers = {
      "Content-Type": mimeMap[extname(filename).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": String(stats.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    if (headOnly) {
      await file.close();
      return new NextResponse(null, { headers });
    }
    return new NextResponse(file.createReadStream() as unknown as BodyInit, { headers });
  } catch {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }
}

export async function HEAD(request: NextRequest) {
  const filename = request.nextUrl.searchParams.get("file");
  const response = filename ? await originalPhoto(filename, true) : await GET(request);
  return new NextResponse(null, { status: response.status, headers: response.headers });
}

export async function GET(request: NextRequest) {
  const filename = request.nextUrl.searchParams.get("file");
  if (filename) return originalPhoto(filename);

  try {
    await mkdir(uploadDir, { recursive: true });
    const fileNames = readdirSync(uploadDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isListedPhoto(entry.name))
      .map((entry) => entry.name)
      .sort();
    const photos = fileNames.map((name) => {
      try {
        const s = statSync(join(uploadDir, name));
        return { name, mtime: Math.floor(s.mtimeMs) };
      } catch {
        return { name, mtime: 0 };
      }
    });
    return NextResponse.json<PhotosResponse>({ photos });
  } catch {
    return NextResponse.json<PhotosResponse>({ photos: [] });
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
    if (!isPhotoName(filename)) return NextResponse.json({ error: "无效的照片名" }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());

    await writeFile(join(uploadDir, filename), bytes);

    return NextResponse.json({ filename, url: `/api/photos?file=${filename}` }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "上传失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const filename = request.nextUrl.searchParams.get("file");
    const { password } = await request.json();

    if (password !== "123") {
      return NextResponse.json({ error: "密码错误" }, { status: 403 });
    }

    if (!filename) {
      return NextResponse.json({ error: "缺少文件名" }, { status: 400 });
    }

    if (!isPhotoName(filename)) return NextResponse.json({ error: "无效的照片名" }, { status: 400 });
    await unlink(join(uploadDir, filename));
    // An old cached version can never be served without its original.
    // Cleanup failures do not turn a successful original deletion into an unretryable error.
    await removeThumbnails(filename).catch(() => console.warn("photo-thumbnail cleanup incomplete"));
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
