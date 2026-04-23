"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

type ComicWallProps = {
  photos: string[];
};

type CommentMap = Record<string, string[]>;
type LikeMap = Record<string, number>;

type ComicReaction = {
  photo: string;
  likes: number;
  comments: { text: string; createdAt: string }[];
};

const rotations = ["-2.5deg", "1.5deg", "-1deg", "2.2deg", "0deg", "-1.8deg"];
const aspectRatios = ["4 / 5", "1 / 1", "3 / 4", "5 / 4", "4 / 3", "2 / 3"];

export default function ComicWall({ photos }: ComicWallProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [likes, setLikes] = useState<LikeMap>({});
  const [comments, setComments] = useState<CommentMap>({});
  const [commentDraft, setCommentDraft] = useState("");
  const [burstPhoto, setBurstPhoto] = useState<string | null>(null);

  const selectedPhoto = selectedIndex === null ? null : photos[selectedIndex];
  const selectedComments = selectedPhoto ? comments[selectedPhoto] ?? [] : [];

  useEffect(() => {
    const controller = new AbortController();
    const searchParams = new URLSearchParams();
    photos.forEach((photo) => searchParams.append("photo", photo));

    fetch(`/api/comic-reactions?${searchParams.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((data: { reactions?: ComicReaction[] }) => {
        const nextLikes: LikeMap = {};
        const nextComments: CommentMap = {};

        data.reactions?.forEach((reaction) => {
          nextLikes[reaction.photo] = reaction.likes;
          nextComments[reaction.photo] = reaction.comments.map((comment) => comment.text);
        });

        setLikes(nextLikes);
        setComments(nextComments);
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setLikes({});
          setComments({});
        }
      });

    return () => controller.abort();
  }, [photos]);

  useEffect(() => {
    if (selectedIndex === null) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedIndex(null);
      if (event.key === "ArrowLeft") {
        setSelectedIndex((current) => (current === null ? current : Math.max(0, current - 1)));
      }
      if (event.key === "ArrowRight") {
        setSelectedIndex((current) =>
          current === null ? current : Math.min(photos.length - 1, current + 1),
        );
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [photos.length, selectedIndex]);

  const modalTitle = useMemo(() => {
    if (selectedIndex === null) return "";
    return `#${String(selectedIndex + 1).padStart(2, "0")}`;
  }, [selectedIndex]);

  async function likePhoto(photo: string) {
    setLikes((current) => ({ ...current, [photo]: (current[photo] ?? 0) + 1 }));
    setBurstPhoto(photo);
    window.setTimeout(() => setBurstPhoto(null), 620);

    try {
      const response = await fetch("/api/comic-reactions", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "like", photo }),
      });
      const data = await response.json();

      if (response.ok && data.reaction) {
        setLikes((current) => ({ ...current, [photo]: data.reaction.likes }));
      }
    } catch {
      setLikes((current) => ({ ...current, [photo]: Math.max((current[photo] ?? 1) - 1, 0) }));
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPhoto) return;

    const text = commentDraft.trim();
    if (!text) return;

    setComments((current) => ({
      ...current,
      [selectedPhoto]: [text, ...(current[selectedPhoto] ?? [])].slice(0, 12),
    }));
    setCommentDraft("");

    try {
      const response = await fetch("/api/comic-reactions", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "comment", photo: selectedPhoto, text }),
      });
      const data = await response.json();

      if (response.ok && data.reaction) {
        setComments((current) => ({
          ...current,
          [selectedPhoto]: data.reaction.comments.map((comment: { text: string }) => comment.text),
        }));
      }
    } catch {
      setComments((current) => ({
        ...current,
        [selectedPhoto]: (current[selectedPhoto] ?? []).filter((comment, index) => index !== 0 || comment !== text),
      }));
    }
  }

  return (
    <>
      <div className="comic-grid">
        {photos.map((photo, index) => {
          const count = likes[photo] ?? 0;
          const photoComments = comments[photo] ?? [];
          const latestComment = photoComments[0];
          const coverComment =
            latestComment && latestComment.length > 5 ? `${latestComment.slice(0, 5)}...` : latestComment;
          const commentCount = photoComments.length;
          const isAboveFold = index < 4;

          return (
            <figure
              key={photo}
              className="comic-frame group"
              style={{
                "--rotate": rotations[index % rotations.length],
                "--ratio": aspectRatios[index % aspectRatios.length],
                "--delay": `${Math.min(index * 35, 900)}ms`,
              } as CSSProperties}
            >
              <button
                type="button"
                className="comic-photo-button"
                onClick={() => setSelectedIndex(index)}
                onDoubleClick={() => likePhoto(photo)}
                aria-label={`打开漫画风格照片 ${index + 1}`}
              >
                <Image
                  src={`/comics/${photo}`}
                  alt={`漫画风格照片 ${index + 1}`}
                  fill
                  sizes="(max-width: 640px) 46vw, (max-width: 1024px) 46vw, 30vw"
                  loading={isAboveFold ? "eager" : "lazy"}
                  fetchPriority={isAboveFold ? "high" : "low"}
                  className="object-cover transition duration-500 group-hover:scale-105"
                />
              </button>
              {latestComment && (
                <button
                  type="button"
                  className="comic-cover-comment"
                  onClick={() => setSelectedIndex(index)}
                  aria-label={`查看最新留言：${latestComment}`}
                >
                  {coverComment}
                </button>
              )}
              <span className="comic-impact" aria-hidden="true">
                BOOM
              </span>
              {burstPhoto === photo && (
                <span className="comic-like-burst" aria-hidden="true">
                  +1
                </span>
              )}
              <figcaption className="absolute bottom-3 left-3 border-2 border-black bg-[#f7e66b] px-2 py-1 text-[10px] font-black text-black shadow-[3px_3px_0_#111]">
                #{String(index + 1).padStart(2, "0")}
              </figcaption>
              <div className="comic-actions" aria-label={`照片 ${index + 1} 互动`}>
                <button type="button" onClick={() => likePhoto(photo)} aria-label="点赞">
                  <span aria-hidden="true">♥</span>
                  {count}
                </button>
                <button type="button" onClick={() => setSelectedIndex(index)} aria-label="查看留言">
                  <span aria-hidden="true">✎</span>
                  {commentCount}
                </button>
              </div>
            </figure>
          );
        })}
      </div>

      {selectedPhoto && selectedIndex !== null && (
        <div className="comic-modal" role="dialog" aria-modal="true" aria-label={`${modalTitle} 放大照片`}>
          <button
            type="button"
            className="comic-modal-backdrop"
            onClick={() => setSelectedIndex(null)}
            aria-label="关闭放大照片"
          />
          <div className="comic-modal-panel">
            <div className="comic-modal-image">
              <Image
                src={`/comics/${selectedPhoto}`}
                alt={`${modalTitle} 漫画风格照片`}
                fill
                sizes="96vw"
                className="object-contain"
                priority
              />
              <button
                type="button"
                className="comic-modal-close"
                onClick={() => setSelectedIndex(null)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            <aside className="comic-comment-panel">
              <div className="flex items-center justify-between gap-3">
                <h2>{modalTitle}</h2>
                <button type="button" className="comic-like-button" onClick={() => likePhoto(selectedPhoto)}>
                  <span aria-hidden="true">♥</span>
                  {likes[selectedPhoto] ?? 0}
                </button>
              </div>

              <form onSubmit={submitComment} className="comic-comment-form">
                <input
                  value={commentDraft}
                  onChange={(event) => setCommentDraft(event.target.value)}
                  placeholder="写一句漫画旁白..."
                  maxLength={80}
                />
                <button type="submit">贴上</button>
              </form>

              <div className="comic-comments">
                {selectedComments.length > 0 ? (
                  selectedComments.map((comment, index) => (
                    <p key={`${comment}-${index}`}>{comment}</p>
                  ))
                ) : (
                  <p className="comic-empty-comment">还没有留言，抢第一个分镜气泡。</p>
                )}
              </div>
            </aside>
          </div>
        </div>
      )}
    </>
  );
}
