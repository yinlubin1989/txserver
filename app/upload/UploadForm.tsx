"use client";

import { useEffect, useMemo, useState } from "react";

interface UploadRecord {
  id: string;
  originalName: string;
  url: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

function formatSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const previewUrl = useMemo(() => {
    if (!file) {
      return "";
    }

    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    fetch("/api/uploads")
      .then((response) => response.json())
      .then((data) => setUploads(data.uploads ?? []))
      .catch(() => setUploads([]));
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setUrl("");

    if (!file) {
      setError("请先选择一张图片");
      return;
    }

    const formData = new FormData();
    formData.append("image", file);
    setIsUploading(true);

    try {
      const response = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "上传失败");
        return;
      }

      setUrl(data.url);
      setUploads((current) => [data.upload, ...current]);
      setFile(null);
      event.currentTarget.reset();
    } catch {
      setError("网络异常，上传失败");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <form
        onSubmit={handleSubmit}
        className="border-[4px] border-black bg-white p-5 shadow-[10px_10px_0_#111] sm:p-7"
      >
        <label className="block">
          <span className="mb-3 block text-sm font-black uppercase text-black">选择图片</span>
          <input
            name="image"
            type="file"
            accept="image/*"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="w-full border-[3px] border-black bg-[#f6ead2] p-3 text-sm font-bold text-black file:mr-4 file:border-0 file:bg-black file:px-4 file:py-2 file:font-black file:text-white"
          />
        </label>

        <div className="mt-6 grid min-h-72 place-items-center border-[3px] border-dashed border-black bg-[#79c7d9]/30 p-4">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="待上传图片预览" className="max-h-80 max-w-full border-[3px] border-black object-contain shadow-[6px_6px_0_#111]" />
          ) : (
            <p className="text-center text-lg font-black text-black">PNG / JPG / WEBP / GIF</p>
          )}
        </div>

        {error && (
          <p className="mt-5 border-[3px] border-black bg-[#ef5b4b] px-4 py-3 font-black text-white shadow-[5px_5px_0_#111]">
            {error}
          </p>
        )}

        {url && (
          <div className="mt-5 border-[3px] border-black bg-[#f7e66b] p-4 shadow-[5px_5px_0_#111]">
            <p className="text-sm font-black uppercase text-black">上传成功，图片地址</p>
            <a href={url} target="_blank" rel="noreferrer" className="mt-2 block break-all font-bold text-black underline">
              {url}
            </a>
          </div>
        )}

        <button
          type="submit"
          disabled={isUploading}
          className="mt-6 w-full border-[3px] border-black bg-black px-5 py-4 text-lg font-black text-white shadow-[6px_6px_0_#ef5b4b] transition hover:-translate-y-1 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isUploading ? "上传中..." : "上传并返回 URL"}
        </button>
      </form>

      <aside className="border-[4px] border-black bg-[#f7e66b] p-5 shadow-[10px_10px_0_#111] sm:p-6">
        <h2 className="text-2xl font-black text-black">上传记录</h2>
        <div className="mt-5 space-y-4">
          {uploads.length === 0 ? (
            <p className="border-[3px] border-black bg-white p-4 font-bold text-black">还没有上传记录。</p>
          ) : (
            uploads.map((upload) => (
              <a
                key={upload.id}
                href={upload.url}
                target="_blank"
                rel="noreferrer"
                className="block border-[3px] border-black bg-white p-3 text-black shadow-[5px_5px_0_#111] transition hover:-translate-y-1"
              >
                <span className="block break-all font-black">{upload.originalName}</span>
                <span className="mt-1 block text-xs font-bold uppercase">
                  {formatSize(upload.size)} / {new Date(upload.createdAt).toLocaleString()}
                </span>
                <span className="mt-2 block break-all text-sm font-bold underline">{upload.url}</span>
              </a>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
