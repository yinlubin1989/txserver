"use client";

import { useEffect, useRef, useState } from "react";
import { Button, StatusMessage } from "@/app/components/ui/PageKit";
import Modal from "@/app/components/ui/Modal";

export interface Photo {
  name: string;
  url: string;
}

export default function PhotoGrid({ photos, onDelete }: { photos: Photo[]; onDelete: (name: string) => void }) {
  const [selected, setSelected] = useState<Photo | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pwd, setPwd] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [imageState, setImageState] = useState<"loading" | "loaded" | "error">("loading");
  const passwordRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const deletionInProgress = useRef(false);

  useEffect(() => {
    if (confirmingDelete) passwordRef.current?.focus();
  }, [confirmingDelete]);

  function closeModal() {
    if (deletionInProgress.current) return;
    setSelected(null);
    setConfirmingDelete(false);
    setPwd("");
    setDeleteError("");
  }

  async function handleDelete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || deletionInProgress.current) return;
    deletionInProgress.current = true;
    setDeleting(true);
    setDeleteError("");

    try {
      const response = await fetch(`/api/photos?file=${encodeURIComponent(selected.name)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      });
      if (!response.ok) {
        const data = await response.json();
        setDeleteError(data.error ?? "删除失败，请重试");
        return;
      }
      onDelete(selected.name);
      deletionInProgress.current = false;
      closeModal();
    } catch {
      setDeleteError("网络异常，删除失败，请重试");
    } finally {
      deletionInProgress.current = false;
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="columns-2 gap-3 sm:columns-3 sm:gap-4 lg:columns-4">
        {photos.map((photo, index) => (
          <button key={photo.name} type="button" onClick={() => { setImageState("loading"); setSelected(photo); }} aria-label={`查看第 ${index + 1} 张照片`} className="group mb-3 block min-h-11 w-full break-inside-avoid overflow-hidden bg-neutral-100 sm:mb-4">
            {/* Photo files are served by the existing streaming endpoint. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={`照片 ${index + 1}`} loading="lazy" className="min-h-24 w-full grayscale transition-all duration-300 group-hover:grayscale-0 group-focus-visible:grayscale-0" />
          </button>
        ))}
      </div>

      {selected && (
        <Modal label={confirmingDelete ? "删除照片" : "照片预览"} onClose={closeModal} initialFocusRef={closeButtonRef} className={confirmingDelete ? "w-[calc(100%-2rem)] max-w-sm bg-white p-6 sm:p-8" : "w-[calc(100%-2rem)] max-w-5xl bg-neutral-950 p-3 text-white sm:p-5"}>
          {confirmingDelete ? (
            <form onSubmit={handleDelete} aria-busy={deleting}>
              <h2 className="text-xl font-medium text-neutral-900">删除照片</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-600">输入密码以确认删除这张照片。</p>
              <label htmlFor="photo-delete-password" className="mt-5 block text-sm text-neutral-700">删除密码</label>
              <input ref={passwordRef} id="photo-delete-password" type="password" autoComplete="current-password" placeholder="输入密码" value={pwd} disabled={deleting} onChange={(event) => { setPwd(event.target.value); setDeleteError(""); }} className="mt-2 min-h-11 w-full border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900" />
              {deleteError && <div className="mt-4"><StatusMessage kind="error">{deleteError}</StatusMessage></div>}
              <div className="mt-6 grid grid-cols-2 gap-3">
                <Button type="button" variant="secondary" disabled={deleting} onClick={closeModal}>取消</Button>
                <Button type="submit" variant="danger" disabled={deleting}>{deleting ? "删除中…" : "确认删除"}</Button>
              </div>
            </form>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between gap-3">
                <button type="button" onClick={() => setConfirmingDelete(true)} className="min-h-11 px-3 text-sm text-white/80 transition-colors hover:text-red-300">删除照片</button>
                <button ref={closeButtonRef} type="button" onClick={closeModal} className="min-h-11 px-3 text-sm text-white transition-colors hover:bg-white/10">关闭 <span aria-hidden="true" className="ml-2">×</span></button>
              </div>
              <div className="relative flex min-h-40 items-center justify-center">
                {imageState === "loading" && <p role="status" className="absolute text-sm text-white/80">原图加载中…</p>}
                {imageState === "error" ? <p role="alert" className="py-16 text-center text-sm text-white/80">图片加载失败，请关闭后重试。</p> : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selected.url} alt="照片大图" onLoad={() => setImageState("loaded")} onError={() => setImageState("error")} className={`max-h-[calc(100dvh-10rem)] max-w-full object-contain ${imageState === "loading" ? "opacity-0" : "opacity-100"}`} />
                )}
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
