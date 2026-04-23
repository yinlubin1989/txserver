import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { connectDB } from "@/lib/mongodb";
import { Upload } from "@/lib/models/Upload";

export const runtime = "nodejs";

const uploadRoot = join(process.cwd(), ".local-uploads");
const imageDir = join(uploadRoot, "images");

const extensionByType: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
};

export async function GET() {
  await connectDB();
  const uploads = await Upload.find().sort({ createdAt: -1 });
  return Response.json({ uploads });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("image");

    if (!(file instanceof File)) {
      return Response.json({ error: "请选择要上传的图片" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return Response.json({ error: "只能上传图片文件" }, { status: 400 });
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

    return Response.json({ upload, url: upload.url }, { status: 201 });
  } catch {
    return Response.json({ error: "上传失败，请稍后重试" }, { status: 500 });
  }
}
