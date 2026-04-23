export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-white dark:bg-black">
      <main className="flex-1" />
      <footer className="py-6 text-center">
        <a
          href="https://beian.miit.gov.cn/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          京ICP备2025157289号-2
        </a>
      </footer>
    </div>
  );
}
