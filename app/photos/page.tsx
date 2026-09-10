"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import PhotoGrid, { type Photo } from "./PhotoGrid";
import type { PhotosResponse } from "@/lib/photos";
import { BackLink, Button, PageShell, SiteFooter, StatusMessage } from "@/app/components/ui/PageKit";

export default function PhotosPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState(0);
  const galleryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/photos", { signal: controller.signal })
      .catch(() => { throw new Error("网络异常，照片加载失败，请重试"); })
      .then(async (response) => {
        if (!response.ok) throw new Error("照片加载失败，请稍后重试");
        const data: PhotosResponse = await response.json().catch(() => {
          throw new Error("照片列表格式异常，请稍后重试");
        });
        if (
          !data || !Array.isArray(data.photos) ||
          data.photos.some((photo) => !photo || typeof photo.name !== "string" || typeof photo.mtime !== "number")
        ) {
          throw new Error("照片列表格式异常，请稍后重试");
        }
        return data.photos.map(({ name }) => ({
          name,
          url: `/api/photos?file=${encodeURIComponent(name)}`,
        }));
      })
      .then((list) => {
        if (!controller.signal.aborted) setPhotos(list);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "照片加载失败，请稍后重试");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [requestId]);

  return (
    <PageShell width="wide">
      <BackLink />
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-neutral-200 py-8 sm:py-10">
        <div>
          <p className="text-xs tracking-[0.24em] text-neutral-500">PHOTOS</p>
          <h1 className="mt-3 text-3xl font-light tracking-[0.08em]">相册</h1>
          <p className="mt-3 text-sm text-neutral-600">{loading ? "正在读取照片…" : error ? "照片暂时无法显示" : `${photos.length} 张照片，点击查看大图`}</p>
        </div>
        <Link href="/photos/upload" className="inline-flex min-h-11 items-center justify-center border border-neutral-800 px-5 text-sm text-neutral-800 transition-colors hover:bg-neutral-900 hover:text-white">
          上传照片 <span aria-hidden="true" className="ml-3">＋</span>
        </Link>
      </header>

      <section ref={galleryRef} tabIndex={-1} className="flex-1 py-8" aria-label="照片列表" aria-busy={loading}>
        {loading ? (
          <div className="py-20 text-center"><StatusMessage>照片加载中…</StatusMessage></div>
        ) : error ? (
          <div className="py-16 text-center">
            <StatusMessage kind="error">{error}</StatusMessage>
            <Button variant="secondary" className="mt-5" onClick={() => { setLoading(true); setError(""); setRequestId((value) => value + 1); }}>重新加载</Button>
          </div>
        ) : photos.length === 0 ? (
          <div className="border border-dashed border-neutral-300 px-5 py-20 text-center">
            <p className="text-base text-neutral-700">相册里还没有照片</p>
            <p className="mt-2 text-sm text-neutral-500">从第一张照片开始记录。</p>
            <Link href="/photos/upload" className="mt-5 inline-flex min-h-11 items-center border-b border-neutral-600 text-sm text-neutral-800">上传第一张 <span aria-hidden="true" className="ml-3">→</span></Link>
          </div>
        ) : (
          <PhotoGrid photos={photos} onDelete={(name) => {
            setPhotos((previous) => previous.filter((photo) => photo.name !== name));
            requestAnimationFrame(() => galleryRef.current?.focus());
          }} />
        )}
      </section>
      <SiteFooter />
    </PageShell>
  );
}
