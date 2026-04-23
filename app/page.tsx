import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { CSSProperties } from "react";
import ComicWall from "./components/ComicWall";

const comicPhotos = readdirSync(join(process.cwd(), "public/comics"))
  .filter((file) => /\.(webp|png|jpe?g)$/i.test(file))
  .sort();

const soundEffects = [
  { text: "POW!", angle: "-10deg", className: "left-[6%] top-[18%] bg-[#ef5b4b]" },
  { text: "WOW!", angle: "9deg", className: "right-[7%] top-[30%] bg-[#f7e66b]" },
  { text: "CLICK!", angle: "7deg", className: "left-[10%] top-[58%] bg-[#79c7d9]" },
  { text: "SNAP!", angle: "-7deg", className: "right-[11%] top-[72%] bg-white" },
];

export default function Home() {
  return (
    <main className="comic-home min-h-screen overflow-hidden">
      <div className="comic-speed-lines" aria-hidden="true" />
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        {soundEffects.map((effect, index) => (
          <span
            key={effect.text}
            className={`comic-sfx absolute hidden border-[3px] border-black px-3 py-1 text-xl font-black text-black shadow-[5px_5px_0_#111] sm:block ${effect.className}`}
            style={
              {
                "--float-delay": `${index * 420}ms`,
                "--sfx-rotate": effect.angle,
              } as CSSProperties
            }
          >
            {effect.text}
          </span>
        ))}
      </div>

      <section className="relative mx-auto flex min-h-[34vh] max-w-7xl flex-col justify-end px-5 pb-8 pt-12 sm:min-h-[38vh] sm:px-8 lg:px-10">
        <div className="comic-sticker absolute left-5 top-5 border-[3px] border-black bg-[#f7e66b] px-3 py-1 text-xs font-black uppercase tracking-[0.28em] text-black shadow-[5px_5px_0_#111] sm:left-8 lg:left-10">
          Comic Wall
        </div>
        <div className="relative z-10 max-w-4xl">
          <p className="comic-caption mb-4 inline-block rotate-[-1deg] border-[3px] border-black bg-white px-4 py-2 text-sm font-black uppercase text-black shadow-[6px_6px_0_#111]">
            Desktop collection: {comicPhotos.length} panels
          </p>
          <h1 className="comic-title relative text-[3.7rem] font-black leading-[0.86] text-black sm:text-[6.8rem] lg:text-[9rem]">
            <span className="comic-burst" aria-hidden="true" />
            漫画照片墙
          </h1>
        </div>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 pb-16 sm:px-8 lg:px-10">
        <ComicWall photos={comicPhotos} />
      </section>

      <footer className="relative mx-auto max-w-7xl px-4 pb-8 text-center sm:px-8 lg:px-10">
        <a
          href="https://beian.miit.gov.cn/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block rotate-[-0.6deg] border-[3px] border-black bg-white px-4 py-2 text-xs font-black text-black shadow-[5px_5px_0_#111] transition hover:-translate-y-1 hover:bg-[#f7e66b]"
        >
          京ICP备2025157289号-2
        </a>
      </footer>
    </main>
  );
}
