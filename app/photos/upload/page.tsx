"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function PhotoUploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setError("");
    if (f) {
      setPreview(URL.createObjectURL(f));
    } else {
      setPreview("");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("请选择一张图片");
      return;
    }

    setUploading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/photos", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "上传失败");
        return;
      }

      setFile(null);
      setPreview("");
      (e.target as HTMLFormElement).reset();
      router.push("/photos");
    } catch {
      setError("网络异常，上传失败");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6 text-black">
      <Link
        href="/photos"
        className="absolute left-6 top-6 text-xs tracking-[0.2em] text-neutral-400 transition-colors duration-300 hover:text-black"
      >
        ← PHOTOS
      </Link>

      <div className="w-full max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <label className="flex flex-col gap-2">
            <span className="text-xs tracking-[0.2em] text-neutral-400">选择图片</span>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="text-sm text-neutral-500 file:mr-4 file:cursor-pointer file:border file:border-black file:bg-transparent file:px-5 file:py-2 file:text-xs file:tracking-[0.15em] file:text-black file:transition-all hover:file:bg-black hover:file:text-white"
            />
          </label>

          {preview && (
            <div className="overflow-hidden border border-neutral-200">
              <img src={preview} alt="预览" className="max-h-64 w-full object-contain" />
            </div>
          )}

          {error && (
            <p className="border border-black bg-black px-4 py-2.5 text-xs tracking-wide text-white">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={uploading || !file}
            className="border border-black py-3 text-xs tracking-[0.25em] text-black transition-all duration-300 hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:border-neutral-200 disabled:text-neutral-300 disabled:hover:bg-white"
          >
            {uploading ? "上传中..." : "上传 →"}
          </button>
        </form>
      </div>

      <footer className="absolute bottom-0 pb-6 text-center">
        <a
          href="https://beian.miit.gov.cn/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-neutral-300 transition-colors duration-300 hover:text-neutral-500"
        >
          京ICP备2025157289号-2
        </a>
      </footer>
    </main>
  );
}
