"use client";

import { useEffect, useRef, useState } from "react";
import { Button, StatusMessage } from "@/app/components/ui/PageKit";

interface UploadRecord {
  id: string;
  originalName: string;
  url: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const previewRef = useRef("");
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const pendingUploadsRef = useRef<UploadRecord[]>([]);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const uploadingRef = useRef(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [historyRequest, setHistoryRequest] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/uploads", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("上传记录加载失败");
        const data: { uploads: UploadRecord[] } = await response.json();
        if (!Array.isArray(data.uploads)) throw new Error("上传记录格式异常");
        return data.uploads;
      })
      .then((records) => {
        if (controller.signal.aborted) return;
        const fetchedIds = new Set(records.map((record) => record.id));
        pendingUploadsRef.current = pendingUploadsRef.current.filter((record) => !fetchedIds.has(record.id));
        setUploads([...pendingUploadsRef.current, ...records]);
      })
      .catch(() => { if (!controller.signal.aborted) setHistoryError("上传记录加载失败，请重试。"); })
      .finally(() => { if (!controller.signal.aborted) setLoadingHistory(false); });
    return () => controller.abort();
  }, [historyRequest]);

  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  function selectFile(nextFile: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = nextFile ? URL.createObjectURL(nextFile) : "";
    setPreviewUrl(previewRef.current);
    setFile(nextFile);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (uploadingRef.current) return;
    setError("");
    setUrl("");
    if (!file) {
      setError("请先选择一张图片");
      return;
    }

    const formData = new FormData();
    formData.append("image", file);
    uploadingRef.current = true;
    setIsUploading(true);
    try {
      const response = await fetch("/api/uploads", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "上传失败");
        return;
      }
      setUrl(data.url);
      pendingUploadsRef.current = [data.upload, ...pendingUploadsRef.current];
      setUploads((current) => [data.upload, ...current]);
      selectFile(null);
      form.reset();
    } catch {
      setError("网络异常，上传失败");
    } finally {
      uploadingRef.current = false;
      setIsUploading(false);
    }
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2 lg:gap-8">
      <form onSubmit={handleSubmit} aria-busy={isUploading} className="min-w-0 border border-neutral-200 bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.035)] sm:p-7">
        <h2 className="text-lg font-medium text-neutral-900">上传图片</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-600">选择一张图片，上传后获取可直接访问的链接。</p>
        <label className="mt-6 block">
          <span className="mb-2 block text-sm text-neutral-700">选择图片</span>
          <input name="image" type="file" accept="image/*" disabled={isUploading} onChange={(event) => { selectFile(event.target.files?.[0] ?? null); setError(""); setUrl(""); }} className="block min-h-11 w-full min-w-0 border border-neutral-300 bg-white p-2 text-sm text-neutral-600 file:mr-3 file:min-h-11 file:cursor-pointer file:border-0 file:bg-neutral-100 file:px-3 file:text-sm file:text-neutral-800 hover:file:bg-neutral-200 disabled:opacity-60" />
        </label>

        <div className="mt-5 grid min-h-56 place-items-center border border-dashed border-neutral-300 bg-neutral-50/70 p-4 sm:min-h-72">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="待上传图片预览" className="max-h-80 max-w-full object-contain" />
          ) : (
            <div className="text-center"><p className="text-sm text-neutral-600">图片预览</p><p className="mt-2 text-xs tracking-wide text-neutral-500">PNG / JPG / WEBP / GIF</p></div>
          )}
        </div>

        {error && <div className="mt-5"><StatusMessage kind="error">{error}</StatusMessage></div>}
        {url && !error && (
          <div className="mt-5 border border-neutral-200 bg-neutral-50 p-4">
            <StatusMessage kind="success">上传成功，图片地址</StatusMessage>
            <a href={url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm leading-6 text-neutral-800 underline decoration-neutral-400 underline-offset-4 hover:decoration-neutral-900">{url}</a>
          </div>
        )}
        <Button type="submit" disabled={isUploading} className="mt-6 w-full">{isUploading ? "上传中…" : "上传并返回 URL"}</Button>
      </form>

      <aside className="min-w-0 border border-neutral-200 bg-white p-5 sm:p-7" aria-busy={loadingHistory}>
        <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-medium text-neutral-900">上传记录</h2>{!loadingHistory && !historyError && <span className="text-sm tabular-nums text-neutral-500">{uploads.length} 条</span>}</div>
        <p className="mt-2 text-sm leading-6 text-neutral-600">点击记录，在新窗口打开图片。</p>
        <div className="mt-6">
          {loadingHistory && <StatusMessage>正在加载上传记录…</StatusMessage>}
          {historyError && <div><StatusMessage kind="error">{historyError}</StatusMessage><Button variant="secondary" className="mt-4" onClick={() => { setHistoryError(""); setLoadingHistory(true); setHistoryRequest((value) => value + 1); }}>重新加载</Button></div>}
          {!loadingHistory && !historyError && uploads.length === 0 && <p className="border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500">还没有上传记录。</p>}
          {uploads.length > 0 && <div className="divide-y divide-neutral-200">
            {uploads.map((upload) => (
              <a key={upload.id} href={upload.url} target="_blank" rel="noreferrer" className="block min-w-0 py-5 text-neutral-800 transition-colors first:pt-0 hover:bg-neutral-50">
                <span className="block break-all text-sm font-medium leading-6">{upload.originalName}</span>
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-neutral-500"><span>{formatSize(upload.size)}</span><time dateTime={upload.createdAt}>{new Date(upload.createdAt).toLocaleString()}</time></span>
                <span className="mt-2 block break-all text-sm leading-6 text-neutral-600 underline decoration-neutral-300 underline-offset-4">{upload.url}</span>
              </a>
            ))}
          </div>}
        </div>
      </aside>
    </div>
  );
}
