import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6 text-black">
      <div className="flex max-w-lg flex-col items-center gap-10 text-center">
        <h1 className="text-4xl font-light tracking-[0.15em] sm:text-5xl">
          LUBIN YIN
        </h1>

        <p className="text-sm leading-relaxed tracking-wide text-neutral-500">
          Engineer · Builder · Minimalist
        </p>

        <ul className="space-y-2 text-sm font-light tracking-wide text-neutral-500">
          <li>
            <span className="mr-2 text-neutral-300">tel</span>
            <a href="tel:13718231649" className="transition-colors duration-300 hover:text-black">
              13718231649
            </a>
          </li>
          <li>
            <span className="mr-2 text-neutral-300">mail</span>
            <a href="mailto:yinlubin1989@gmail.com" className="transition-colors duration-300 hover:text-black">
              yinlubin1989@gmail.com
            </a>
          </li>
          <li>
            <span className="mr-2 text-neutral-300">loc</span>
            <span>北京市石景山区古城</span>
          </li>
        </ul>

        <Link
          href="/books"
          className="border border-black px-8 py-2.5 text-xs tracking-[0.25em] text-black transition-all duration-300 hover:bg-black hover:text-white"
        >
          BOOKS →
        </Link>

        <div className="h-px w-8 bg-neutral-200" />
      </div>

      <footer className="absolute bottom-0 pb-6 text-center">
        <a
          href="https://beian.miit.gov.cn/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-neutral-300 transition-colors duration-300 hover:text-neutral-500"
        >
          京ICP备2025157289号-2
        </a>
      </footer>
    </main>
  );
}
