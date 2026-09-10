import UploadForm from "./UploadForm";
import { BackLink, PageShell, SiteFooter } from "@/app/components/ui/PageKit";

export default function UploadPage() {
  return (
    <PageShell width="wide">
      <BackLink />
      <header className="py-8 sm:py-10">
        <p className="text-xs tracking-[0.24em] text-neutral-500">UPLOAD</p>
        <h1 className="mt-3 text-3xl font-light tracking-[0.08em]">图片上传</h1>
      </header>
      <UploadForm />
      <SiteFooter />
    </PageShell>
  );
}
