"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BackLink, Button, PageShell, SiteFooter, StatusMessage } from "@/app/components/ui/PageKit";

export default function PhotoUploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const previewRef = useRef("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);

  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  function selectFile(nextFile: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = nextFile ? URL.createObjectURL(nextFile) : "";
    setPreview(previewRef.current);
    setFile(nextFile);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (uploadingRef.current) return;
    if (!file) { setError("请选择一张图片"); return; }
    uploadingRef.current = true;
    setUploading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("image", file);
      const response = await fetch("/api/photos", { method: "POST", body: formData });
      if (!response.ok) {
        let message = "上传失败";
        try { const data = await response.json(); message = data.error ?? message; } catch {}
        setError(message);
        return;
      }
      selectFile(null);
      form.reset();
      router.push("/photos");
    } catch {
      setError("网络异常，上传失败");
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }

  return (
    <PageShell width="reading">
      <BackLink href="/photos">返回相册</BackLink>
      <div className="mx-auto w-full max-w-lg py-8 sm:py-10">
        <header className="mb-7">
          <p className="text-xs tracking-[0.24em] text-neutral-500">NEW PHOTO</p>
          <h1 className="mt-3 text-3xl font-light tracking-[0.08em]">上传照片</h1>
          <p className="mt-3 text-sm leading-6 text-neutral-600">选择一张图片，上传完成后回到相册。</p>
        </header>
        <form onSubmit={handleSubmit} aria-busy={uploading} className="flex flex-col gap-5 border border-neutral-200 bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.035)] sm:p-7">
          <label className="flex min-w-0 flex-col gap-2">
            <span className="text-sm text-neutral-700">选择图片</span>
            <input type="file" accept="image/*" disabled={uploading} onChange={(event) => { selectFile(event.target.files?.[0] ?? null); setError(""); }} className="block min-h-11 w-full min-w-0 border border-neutral-300 bg-white p-2 text-sm text-neutral-600 file:mr-3 file:min-h-11 file:cursor-pointer file:border-0 file:bg-neutral-100 file:px-3 file:text-sm file:text-neutral-800 hover:file:bg-neutral-200 disabled:opacity-60" />
          </label>
          <div className="grid min-h-52 place-items-center overflow-hidden border border-dashed border-neutral-300 bg-neutral-50/70 p-3">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="待上传照片预览" className="max-h-72 max-w-full object-contain" />
            ) : <p className="text-sm text-neutral-500">选择照片后可在这里预览</p>}
          </div>
          {error && <StatusMessage kind="error">{error}</StatusMessage>}
          <Button type="submit" disabled={uploading || !file}>{uploading ? "上传中…" : "上传到相册 →"}</Button>
        </form>
      </div>
      <SiteFooter />
    </PageShell>
  );
}
