import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

export const runtime = "nodejs";

const imageDir = join(process.cwd(), ".local-uploads", "images");

const contentTypeByExt: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

export async function GET(
  _request: Request,
  context: RouteContext<"/api/uploads/files/[filename]">,
) {
  const { filename } = await context.params;
  const safeFilename = basename(filename);

  if (safeFilename !== filename) {
    return Response.json({ error: "无效的文件名" }, { status: 400 });
  }

  try {
    const file = await readFile(join(imageDir, safeFilename));
    const contentType = contentTypeByExt[extname(safeFilename).toLowerCase()] ?? "application/octet-stream";

    return new Response(file, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return Response.json({ error: "图片不存在" }, { status: 404 });
  }
}
