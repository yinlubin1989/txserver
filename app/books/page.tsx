import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { BackLink } from "../components/ui/PageKit";

export const metadata: Metadata = {
  title: "图书书架",
  description: "桌面三列、移动端两列的简洁图书书架",
};

const books = [
  {
    title: "深夜书店",
    author: "林雾",
    note: "短篇集",
    palette: ["#f4efe6", "#c7d7cf"],
    ink: "#17211c",
    spine: "#2f5647",
  },
  {
    title: "山海札记",
    author: "南川",
    note: "旅行",
    palette: ["#f8e7c8", "#e6b672"],
    ink: "#2b2115",
    spine: "#9f5d35",
  },
  {
    title: "白日漫游",
    author: "许知",
    note: "随笔",
    palette: ["#e8eff5", "#b9c8dc"],
    ink: "#142235",
    spine: "#455f82",
  },
  {
    title: "小镇来信",
    author: "陈禾",
    note: "小说",
    palette: ["#f2ded8", "#d8897f"],
    ink: "#251817",
    spine: "#8b3e38",
  },
  {
    title: "雨后地图",
    author: "周明",
    note: "诗集",
    palette: ["#e9eadf", "#a9b29a"],
    ink: "#1e241c",
    spine: "#5b6c48",
  },
  {
    title: "慢火咖啡",
    author: "顾蓝",
    note: "生活",
    palette: ["#f0e2cc", "#c49564"],
    ink: "#271d12",
    spine: "#725137",
  },
];

export default function BooksPage() {
  return (
    <main className="min-h-dvh bg-[#f7f4ee] text-[#1f211d]">
      <section className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-5 pb-8 pt-6 sm:px-8 sm:pt-10">
        <div className="mb-7"><BackLink /></div>
        <header className="flex items-end justify-between gap-4 border-b border-[#d8d0c4] pb-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-[#696158]">Library</p>
            <h1 className="mt-2 text-[2rem] font-semibold leading-none tracking-normal">图书书架</h1>
          </div>
          <p className="shrink-0 pb-1 text-sm text-[#696158]">{books.length} 本</p>
        </header>

        <div className="grid grid-cols-2 gap-x-4 gap-y-8 py-8 sm:gap-x-7 md:grid-cols-3 md:gap-x-9 md:gap-y-10 md:py-10">
          {books.map((book) => (
            <article key={book.title} className="min-w-0">
              <div
                className="relative aspect-[3/4.25] overflow-hidden rounded-[6px] border border-black/10 shadow-[0_16px_32px_rgba(37,31,23,0.14)]"
                style={
                  {
                    "--cover-a": book.palette[0],
                    "--cover-b": book.palette[1],
                    "--cover-ink": book.ink,
                    "--cover-spine": book.spine,
                  } as CSSProperties
                }
              >
                <div className="absolute inset-0 bg-[linear-gradient(135deg,var(--cover-a),var(--cover-b))]" />
                <div className="absolute inset-y-0 left-0 w-[12%] bg-[var(--cover-spine)]/95" />
                <div className="absolute inset-x-[18%] top-[13%] h-px bg-[var(--cover-ink)]/35" />
                <div className="absolute inset-x-[18%] bottom-[18%] h-px bg-[var(--cover-ink)]/35" />
                <div className="absolute left-[18%] right-[12%] top-[20%]">
                  <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-[var(--cover-ink)]/70">
                    {book.note}
                  </p>
                  <h2 className="mt-3 text-lg font-semibold leading-snug tracking-normal text-[var(--cover-ink)] sm:text-2xl">
                    {book.title}
                  </h2>
                </div>
                <p className="absolute bottom-[8%] left-[18%] right-[12%] text-sm font-medium text-[var(--cover-ink)]/80">
                  {book.author}
                </p>
                <div className="absolute inset-0 bg-[linear-gradient(110deg,rgba(255,255,255,0.35),transparent_32%,rgba(0,0,0,0.08)_100%)]" />
              </div>
              <div className="mt-3">
                <h3 className="text-base font-medium leading-6">{book.title}</h3>
                <p className="mt-1 text-sm text-[#696158]">{book.author}</p>
              </div>
            </article>
          ))}
        </div>

        <footer className="mt-auto border-t border-[#d8d0c4] pt-5 text-sm leading-6 text-[#696158]">
          今日书架保持简洁，留一点时间给阅读。
        </footer>
      </section>
    </main>
  );
}
