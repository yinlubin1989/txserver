import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicReport, readReport } from "@/lib/newsReports/storage.mjs";
import { BackLink, PageShell, SiteFooter } from "../../components/ui/PageKit";
import { ReportView } from "../ReportView";
import type { NewsReport } from "../types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "日报精读 · Lubin Yin", description: "完整日报、参考来源与重点语音摘要。" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9]{64}$/.test(id)) notFound();
  const report = await readReport(id);
  if (!report) notFound();
  return <PageShell width="reading">
    <BackLink href="/news">全部日报</BackLink>
    <ReportView key={id} initialReport={publicReport(report) as NewsReport} />
    <SiteFooter />
  </PageShell>;
}
