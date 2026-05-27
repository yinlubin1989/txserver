import Link from "next/link";

export default function PhotosPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6 text-black">
      <Link
        href="/"
        className="absolute left-6 top-6 text-xs tracking-[0.2em] text-neutral-400 transition-colors duration-300 hover:text-black"
      >
        ← HOME
      </Link>

      <p className="text-sm tracking-wide text-neutral-300">暂无照片</p>

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
