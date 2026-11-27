import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";

export const photoDir = join(process.cwd(), ".local-uploads", "photos");

export function isPhotoName(name: string | null): name is string {
  return !!name && !name.startsWith(".") && !/[\\/\u0000-\u001f]/.test(name) && Buffer.byteLength(name) <= 255;
}

export function isListedPhoto(name: string) {
  return isPhotoName(name) && /\.(webp|png|jpe?g|gif)$/i.test(name);
}

export async function openPhoto(name: string) {
  // Do not follow links into sibling upload directories or block on special files.
  const file = await open(join(photoDir, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await file.stat({ bigint: true });
    if (!stats.isFile()) throw Object.assign(new Error("文件不存在"), { code: "ENOENT" });
    return { file, stats };
  } catch (error) {
    await file.close();
    throw error;
  }
}
