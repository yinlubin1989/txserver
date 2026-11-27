import { createHash, randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { isListedPhoto, openPhoto, photoDir } from "./storage";

const cacheRoot = join(photoDir, "..", "photo-thumbnails");
const pending = new Map<string, Promise<Buffer>>();
const conversionQueue: Array<() => void> = [];
let activeConversions = 0;

async function withConversionSlot(convert: () => Promise<Buffer>) {
  if (activeConversions < 2) activeConversions++;
  else await new Promise<void>(resolve => conversionQueue.push(resolve));
  try {
    return await convert();
  } finally {
    const next = conversionQueue.shift();
    if (next) next();
    else activeConversions--;
  }
}

function cacheDirectory(name: string) {
  return join(cacheRoot, createHash("sha256").update(name).digest("hex"));
}

function version(stats: BigIntStats) {
  return createHash("sha256")
    .update(`webp-640-v1:${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`)
    .digest("hex");
}

function fileError(error: unknown) {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function thumbnailError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

async function generateThumbnail(name: string, expected: string, cacheDir: string, path: string) {
  const { file, stats } = await openPhoto(name);
  let thumbnail: Buffer;
  try {
    if (version(stats) !== expected) throw thumbnailError("照片已更新，请重试", 409);
    // libvips reads the open file directly on our Linux server and macOS dev machines.
    // This avoids both a full original-sized JS buffer and reopening a replaced path.
    const input = process.platform === "linux" ? `/proc/self/fd/${file.fd}` :
      process.platform === "darwin" ? `/dev/fd/${file.fd}` : await file.readFile();
    try {
      thumbnail = await sharp(input, { page: 0, pages: 1 })
        .autoOrient()
        .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 76, effort: 3 })
        .toBuffer();
    } catch {
      throw thumbnailError("无法读取这张图片", 415);
    }
  } finally {
    await file.close();
  }

  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  const temporary = join(cacheDir, randomUUID() + ".tmp");
  try {
    await writeFile(temporary, thumbnail, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  // A deletion can finish while sharp is still encoding and before the rename above.
  // Remove this obsolete version without touching a concurrently replaced photo.
  try {
    if (await sourceVersion(name) !== expected) throw thumbnailError("照片已更新，请重试", 409);
  } catch (error) {
    await rm(path, { force: true });
    await rmdir(cacheDir).catch(reason => {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(fileError(reason) || "")) throw reason;
    });
    throw error;
  }
  return thumbnail;
}

async function cachedThumbnail(name: string, key: string) {
  const directory = cacheDirectory(name);
  const path = join(directory, key + ".webp");
  try { return await readFile(path); }
  catch (error) { if (fileError(error) !== "ENOENT") throw error; }

  let job = pending.get(path);
  if (!job) {
    job = withConversionSlot(() => generateThumbnail(name, key, directory, path)).finally(() => pending.delete(path));
    pending.set(path, job);
  }
  return job;
}

async function sourceVersion(name: string) {
  const info = await lstat(join(photoDir, name), { bigint: true });
  if (!info.isFile()) throw thumbnailError("文件不存在", 404);
  return version(info);
}

export async function removeThumbnails(name: string) {
  await rm(cacheDirectory(name), { recursive: true, force: true });
}

export async function getPhotoThumbnail(request: Request) {
  const name = new URL(request.url).searchParams.get("file");
  if (!name || !isListedPhoto(name)) {
    return Response.json({ error: "无效的照片名" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const key = await sourceVersion(name);
    const headers = {
      "Content-Type": "image/webp", "Cache-Control": "private, no-cache", ETag: '"' + key + '"',
    };
    if (request.headers.get("If-None-Match") === headers.ETag) return new Response(null, { status: 304, headers });
    const bytes = await cachedThumbnail(name, key);
    if (await sourceVersion(name) !== key) throw thumbnailError("照片已更新，请重试", 409);
    return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Length": String(bytes.length) } });
  } catch (error) {
    const status = (error as { status?: number }).status;
    const missing = ["ENOENT", "ENOTDIR", "ELOOP"].includes(fileError(error) || "");
    return Response.json({ error: status ? (error as Error).message : missing ? "文件不存在" : "缩略图暂时无法读取" },
      { status: status ?? (missing ? 404 : 500), headers: { "Cache-Control": "no-store" } });
  }
}
