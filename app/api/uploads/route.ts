import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { Upload } from "@/lib/models/Upload";

export const runtime = "nodejs";

const uploadRoot = join(process.cwd(), ".local-uploads");
const imageDir = join(uploadRoot, "images");
const publicBaseUrl = "https://yinlubin.cn";

const extensionByType: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
};

function withCors(response: Response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  response.headers.set("Access-Control-Max-Age", "86400");
  return response;
}

function toAbsoluteUrl(url: string) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return new URL(url, publicBaseUrl).toString();
}

export function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET() {
  await connectDB();
  const uploads = (await Upload.find().sort({ createdAt: -1 })).map((upload) => {
    const item = upload.toJSON();
    return {
      ...item,
      url: toAbsoluteUrl(item.url),
    };
  });

  return withCors(Response.json({ uploads }));
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("image");

    if (!(file instanceof File)) {
      return withCors(Response.json({ error: "请选择要上传的图片" }, { status: 400 }));
    }

    if (!file.type.startsWith("image/")) {
      return withCors(Response.json({ error: "只能上传图片文件" }, { status: 400 }));
    }

    await connectDB();
    await mkdir(imageDir, { recursive: true });

    const id = randomUUID();
    const fallbackExt = extensionByType[file.type] ?? ".img";
    const sourceExt = extname(file.name).toLowerCase();
    const extension = sourceExt && sourceExt.length <= 8 ? sourceExt : fallbackExt;
    const filename = `${id}${extension}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const filePath = join(imageDir, filename);

    await writeFile(filePath, bytes);

    let upload;
    try {
      upload = await Upload.create({
        originalName: file.name,
        filename,
        url: `/api/uploads/files/${filename}`,
        mimeType: file.type,
        size: file.size,
      });
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }

    const uploadJson = upload.toJSON();
    const absoluteUrl = toAbsoluteUrl(uploadJson.url);

    return withCors(
      Response.json(
        {
          upload: {
            ...uploadJson,
            url: absoluteUrl,
          },
          url: absoluteUrl,
        },
        { status: 201 },
      ),
    );
  } catch {
    return withCors(Response.json({ error: "上传失败，请稍后重试" }, { status: 500 }));
  }
}
