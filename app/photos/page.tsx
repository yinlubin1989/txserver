"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PhotoGrid from "./PhotoGrid";

interface Photo {
  name: string;
  url: string;
}

export default function PhotosPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/photos")
      .then((res) => res.json())
      .then((data) => {
        const list = (data.photos ?? []) as string[];
        setPhotos(
          list.map((name) => ({
            name,
            url: `/api/photos?file=${name}`,
          })),
        );
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-white px-6 pb-16 text-black">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between py-10">
          <Link
            href="/"
            className="text-xs tracking-[0.2em] text-neutral-400 transition-colors duration-300 hover:text-black"
          >
            ← HOME
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-xs tracking-[0.2em] text-neutral-300">
              {loading ? "..." : `${photos.length} PHOTOS`}
            </span>
            <Link
              href="/photos/upload"
              className="border border-black px-4 py-1.5 text-[11px] tracking-[0.25em] text-black transition-all duration-300 hover:bg-black hover:text-white"
            >
              + UPLOAD
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <p className="text-sm tracking-wide text-neutral-300">加载中...</p>
          </div>
        ) : photos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32">
            <p className="text-sm tracking-wide text-neutral-300">暂无照片</p>
            <Link
              href="/photos/upload"
              className="mt-4 border border-black px-6 py-2 text-xs tracking-[0.25em] text-black transition-all duration-300 hover:bg-black hover:text-white"
            >
              上传第一张 →
            </Link>
          </div>
        ) : (
          <PhotoGrid
            photos={photos}
            onDelete={(name) => setPhotos((prev) => prev.filter((p) => p.name !== name))}
          />
        )}

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
