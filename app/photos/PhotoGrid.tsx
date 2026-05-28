"use client";

import { useState } from "react";

interface Photo {
  name: string;
  url: string;
}

export default function PhotoGrid({
  photos,
  onDelete,
}: {
  photos: Photo[];
  onDelete: (name: string) => void;
}) {
  const [selected, setSelected] = useState<Photo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Photo | null>(null);
  const [pwd, setPwd] = useState("");
  const [deleteError, setDeleteError] = useState("");

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteError("");

    try {
      const res = await fetch(
        `/api/photos?file=${deleteTarget.name}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pwd }),
        },
      );

      if (!res.ok) {
        const data = await res.json();
        setDeleteError(data.error ?? "删除失败");
        return;
      }

      onDelete(deleteTarget.name);
      setDeleteTarget(null);
      setPwd("");
    } catch {
      setDeleteError("网络异常");
    }
  }

  return (
    <>
      <div className="columns-2 gap-3 sm:columns-3 sm:gap-4 lg:columns-4">
        {photos.map((photo, i) => (
          <button
            key={photo.name}
            onClick={() => setSelected(photo)}
            className="group mb-3 block w-full overflow-hidden sm:mb-4"
          >
            <img
              src={photo.url}
              alt={`Photo ${i + 1}`}
              loading="lazy"
              className="w-full grayscale transition-all duration-500 group-hover:grayscale-0"
            />
          </button>
        ))}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setSelected(null)}
        >
          <button
            className="absolute right-4 top-4 text-sm tracking-[0.2em] text-white/60 transition-colors hover:text-white"
            onClick={() => setSelected(null)}
          >
            CLOSE
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelected(null);
              setDeleteTarget(selected);
            }}
            className="absolute left-4 top-4 text-sm tracking-[0.2em] text-white/40 transition-colors hover:text-red-400"
          >
            DEL
          </button>
          <img
            src={selected.url}
            alt="Enlarged photo"
            className="max-h-[90vh] max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-xs bg-white p-6">
            <p className="text-xs tracking-[0.2em] text-neutral-500">
              删除照片
            </p>
            <input
              type="password"
              placeholder="输入密码"
              value={pwd}
              onChange={(e) => {
                setPwd(e.target.value);
                setDeleteError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleDelete()}
              autoFocus
              className="mt-4 w-full border border-black px-3 py-2 text-sm outline-none"
            />
            {deleteError && (
              <p className="mt-3 text-xs text-red-400">{deleteError}</p>
            )}
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => {
                  setDeleteTarget(null);
                  setPwd("");
                  setDeleteError("");
                }}
                className="flex-1 border border-neutral-200 py-2 text-xs tracking-[0.2em] text-neutral-400 transition-colors hover:border-black hover:text-black"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 border border-black py-2 text-xs tracking-[0.2em] transition-all hover:bg-black hover:text-white"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
