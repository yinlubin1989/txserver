import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listReports } from "@/lib/newsReports/storage.mjs";
import { BackLink, PageShell, SiteFooter } from "../components/ui/PageKit";
import { AUDIO_STATUS_LABELS, formatReportDate, type ReportListItem } from "./types";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "日报 · Lubin Yin", description: "每日简报，随时阅读与收听。" };

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const { page: parameter } = await searchParams;
  if (parameter !== undefined && (typeof parameter !== "string" || !/^[1-9]\d{0,5}$/.test(parameter))) notFound();
  const page = parameter === undefined ? 1 : Number(parameter);
  const result = await listReports({ page });
  const items = result.items as ReportListItem[];
  return (
    <PageShell width="reading">
      <BackLink />
      <header className={styles.header}>
        <p className={styles.eyebrow}>GROKBOT / DAILY BRIEF</p>
        <div className={styles.heading}><h1>日报</h1><span>按日留存，随时读听。</span></div>
      </header>
      {items.length ? (
        <ol className={styles.list} aria-label="日报列表">
          {items.map(item => (
            <li key={item.id}>
              <Link href={`/news/${item.id}`} className={styles.item}>
                <time dateTime={item.reportDate} className={styles.date}>{formatReportDate(item.reportDate)}</time>
                <div className={styles.content}>
                  <h2>{item.title}</h2>
                  <p className={styles.excerpt}>{item.excerpt}</p>
                  <p className={styles.metadata}>{AUDIO_STATUS_LABELS[item.audioStatus]}</p>
                </div>
                <span className={styles.arrow} aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ol>
      ) : <div className={styles.empty}><p>{page === 1 ? "还没有日报。" : "这一页没有更多日报。"}</p><span>{page === 1 ? "收到正式日报后，会保存在这里。" : "可以返回上一页继续阅读。"}</span></div>}
      {(page > 1 || result.hasMore) && <nav className={styles.pagination} aria-label="日报分页">
        {page > 1 ? <Link href={page === 2 ? "/news" : `/news?page=${page - 1}`}>← 上一页</Link> : <span />}
        <span>第 {page} 页</span>
        {result.hasMore ? <Link href={`/news?page=${page + 1}`}>下一页 →</Link> : <span />}
      </nav>}
      <SiteFooter />
    </PageShell>
  );
}
