import { readdirSync } from "node:fs";
import { join } from "node:path";
import Image from "next/image";
import type { CSSProperties } from "react";

const comicPhotos = readdirSync(join(process.cwd(), "public/comics"))
  .filter((file) => /\.(webp|png|jpe?g)$/i.test(file))
  .sort();

const rotations = ["-2.5deg", "1.5deg", "-1deg", "2.2deg", "0deg", "-1.8deg"];
const aspectRatios = ["4 / 5", "1 / 1", "3 / 4", "5 / 4", "4 / 3", "2 / 3"];

export default function Home() {
  return (
    <main className="comic-home min-h-screen overflow-hidden">
      <section className="relative mx-auto flex min-h-[34vh] max-w-7xl flex-col justify-end px-5 pb-8 pt-12 sm:min-h-[38vh] sm:px-8 lg:px-10">
        <div className="absolute left-5 top-5 border-[3px] border-black bg-[#f7e66b] px-3 py-1 text-xs font-black uppercase tracking-[0.28em] text-black shadow-[5px_5px_0_#111] sm:left-8 lg:left-10">
          Comic Wall
        </div>
        <div className="relative z-10 max-w-4xl">
          <p className="mb-4 inline-block rotate-[-1deg] border-[3px] border-black bg-white px-4 py-2 text-sm font-black uppercase text-black shadow-[6px_6px_0_#111]">
            Desktop collection: {comicPhotos.length} panels
          </p>
          <h1 className="comic-title text-[3.7rem] font-black leading-[0.86] text-black sm:text-[6.8rem] lg:text-[9rem]">
            漫画照片墙
          </h1>
        </div>
      </section>

      <section className="relative mx-auto max-w-7xl px-4 pb-16 sm:px-8 lg:px-10">
        <div className="comic-grid">
          {comicPhotos.map((photo, index) => (
            <figure
              key={photo}
              className="comic-frame group"
              style={{
                "--rotate": rotations[index % rotations.length],
                "--ratio": aspectRatios[index % aspectRatios.length],
                "--delay": `${Math.min(index * 35, 900)}ms`,
              } as CSSProperties}
            >
              <div className="relative h-full w-full overflow-hidden bg-white">
                <Image
                  src={`/comics/${photo}`}
                  alt={`漫画风格照片 ${index + 1}`}
                  fill
                  sizes="(max-width: 640px) 92vw, (max-width: 1024px) 46vw, 30vw"
                  className="object-cover transition duration-500 group-hover:scale-105"
                />
              </div>
              <figcaption className="absolute bottom-3 left-3 border-2 border-black bg-[#f7e66b] px-2 py-1 text-[10px] font-black text-black shadow-[3px_3px_0_#111]">
                #{String(index + 1).padStart(2, "0")}
              </figcaption>
            </figure>
          ))}
        </div>
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
