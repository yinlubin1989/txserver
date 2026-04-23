import Link from "next/link";
import UploadForm from "./UploadForm";

export default function UploadPage() {
  return (
    <main className="comic-home min-h-screen overflow-hidden px-5 py-8 sm:px-8 lg:px-10">
      <div className="comic-speed-lines" aria-hidden="true" />
      <section className="relative z-10 mx-auto max-w-6xl">
        <Link
          href="/"
          className="inline-block border-[3px] border-black bg-white px-4 py-2 text-sm font-black text-black shadow-[5px_5px_0_#111] transition hover:-translate-y-1 hover:bg-[#f7e66b]"
        >
          返回首页
        </Link>

        <div className="py-10 sm:py-12">
          <p className="mb-4 inline-block rotate-[-1deg] border-[3px] border-black bg-[#79c7d9] px-4 py-2 text-sm font-black uppercase text-black shadow-[6px_6px_0_#111]">
            Local image uploader
          </p>
          <h1 className="comic-title max-w-4xl text-[3.4rem] font-black leading-[0.9] text-black sm:text-[5.8rem]">
            图片上传
          </h1>
        </div>

        <UploadForm />
      </section>
    </main>
  );
}
