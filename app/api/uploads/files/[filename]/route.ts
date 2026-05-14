import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { NextResponse } from "next/server";

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

function withCors(response: Response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  response.headers.set("Access-Control-Max-Age", "86400");
  return response;
}

export function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET(
  _request: Request,
  context: RouteContext<"/api/uploads/files/[filename]">,
) {
  const { filename } = await context.params;
  const safeFilename = basename(filename);

  if (safeFilename !== filename) {
    return withCors(Response.json({ error: "无效的文件名" }, { status: 400 }));
  }

  try {
    const file = await readFile(join(imageDir, safeFilename));
    const contentType = contentTypeByExt[extname(safeFilename).toLowerCase()] ?? "application/octet-stream";

    return withCors(new Response(file, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    }));
  } catch {
    return withCors(Response.json({ error: "图片不存在" }, { status: 404 }));
  }
}
