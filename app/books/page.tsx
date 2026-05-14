import type { Metadata } from "next";
import type { CSSProperties } from "react";

export const metadata: Metadata = {
  title: "图书书架",
  description: "移动端两列图书书架",
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
      <section className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col px-5 pb-8 pt-6">
        <header className="flex items-end justify-between border-b border-[#d8d0c4] pb-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-[#81796f]">Library</p>
            <h1 className="mt-2 text-[2rem] font-semibold leading-none tracking-normal">图书书架</h1>
          </div>
          <p className="pb-1 text-sm text-[#81796f]">{books.length} 本</p>
        </header>

        <div className="grid grid-cols-2 gap-x-4 gap-y-7 py-7">
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
                  <h2 className="mt-3 text-[1.35rem] font-semibold leading-[1.08] tracking-normal text-[var(--cover-ink)]">
                    {book.title}
                  </h2>
                </div>
                <p className="absolute bottom-[8%] left-[18%] right-[12%] text-sm font-medium text-[var(--cover-ink)]/80">
                  {book.author}
                </p>
                <div className="absolute inset-0 bg-[linear-gradient(110deg,rgba(255,255,255,0.35),transparent_32%,rgba(0,0,0,0.08)_100%)]" />
              </div>
              <div className="mt-3">
                <h3 className="truncate text-[0.95rem] font-medium leading-5">{book.title}</h3>
                <p className="mt-0.5 text-xs text-[#81796f]">{book.author}</p>
              </div>
            </article>
          ))}
        </div>

        <footer className="mt-auto border-t border-[#d8d0c4] pt-4 text-xs leading-5 text-[#81796f]">
          今日书架保持简洁，两列浏览。
        </footer>
      </section>
    </main>
  );
}
