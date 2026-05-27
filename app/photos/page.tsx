import { readdirSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import PhotoGrid from "./PhotoGrid";

const photos = readdirSync(join(process.cwd(), "public/comics"))
  .filter((file) => /\.(webp|png|jpe?g)$/i.test(file))
  .sort();

export default function PhotosPage() {
  return (
    <main className="min-h-screen bg-white px-6 pb-16 text-black">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between py-10">
          <Link
            href="/"
            className="text-xs tracking-[0.2em] text-neutral-400 transition-colors duration-300 hover:text-black"
          >
            ← HOME
          </Link>
          <span className="text-xs tracking-[0.2em] text-neutral-300">
            {photos.length} PHOTOS
          </span>
        </div>

        <PhotoGrid photos={photos} />

        <footer className="mt-16 pb-6 text-center">
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-neutral-300 transition-colors duration-300 hover:text-neutral-500"
          >
            京ICP备2025157289号-2
          </a>
        </footer>
      </div>
    </main>
  );
}
