import Link from "next/link";
import UploadForm from "./UploadForm";

export default function UploadPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-12 text-black sm:px-8">
      <section className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="inline-block text-xs tracking-[0.2em] text-neutral-400 transition-colors duration-300 hover:text-black"
        >
          ← HOME
        </Link>

        <div className="py-10">
          <h1 className="text-3xl font-light tracking-[0.1em]">
            Upload
          </h1>
        </div>

        <UploadForm />
      </section>
    </main>
  );
}
