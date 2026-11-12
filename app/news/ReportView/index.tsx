"use client";

import type { ReactNode } from "react";
import { formatReportDate, formatReportTime, isProcessing, safeSourceUrl, type NewsReport } from "../types";
import { useReport } from "./useReport";
import { AudioPlayer } from "./components/AudioPlayer";
import styles from "./style.module.css";

function Citations({ ids, sources }: { ids: string[]; sources: NewsReport["sources"] }) {
  return <>{ids.map(id => {
    const index = sources.findIndex(source => source.id === id);
    return index < 0 ? null : <sup className={styles.citation} key={id}><a href={`#source-${id}`} aria-label={`查看来源 ${index + 1}`}>[{index + 1}]</a></sup>;
  })}</>;
}

function SectionTitle({ number, children }: { number: string; children: ReactNode }) {
  return <h2 className={styles.sectionTitle}><span>{number}</span>{children}</h2>;
}

export function ReportView({ initialReport }: { initialReport: NewsReport }) {
  const { report, error, retry } = useReport(initialReport);
  const processing = isProcessing(report.status);
  return <article className={styles.report}>
    <header className={styles.header}>
      <div className={styles.kicker}><span>GROKBOT / DAILY BRIEF</span><time dateTime={report.reportDate}>{formatReportDate(report.reportDate)}</time></div>
      <h1>{report.title}</h1>
      <p className={styles.updated}>资料更新于 {formatReportTime(report.updatedAt)}<span>北京时间</span></p>
    </header>
    {report.audio.status === "ready" && report.audio.url ? <AudioPlayer key={report.audio.url} url={report.audio.url} transcript={report.body?.voiceScript ?? ""} /> :
      <div className={styles.audioStatus}><span>听重点</span><span>{report.audio.status === "pending" ? "语音摘要准备中" : "语音摘要暂不可用"}</span></div>}
    {processing && <div className={styles.progress} role="status"><span className={styles.progressDot} aria-hidden="true" /><p>{report.status === "queued" ? "正在等待补充资料" : "正在联网补充资料"}<span>可以先阅读下方原日报，完成后页面会自动更新。</span></p></div>}
    {error && <div className={styles.notice} role="alert"><p>{error}</p><button type="button" onClick={retry}>重新获取 →</button></div>}
    {report.warnings.length > 0 && <aside className={styles.notice} aria-label="资料说明"><p className={styles.noticeTitle}>资料说明</p><ul>{report.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}</ul></aside>}
    {report.body && <>
      {report.body.intro && <p className={styles.intro}>{report.body.intro}</p>}
      {report.body.highlights.length > 0 && <section className={styles.highlights} aria-labelledby="highlights-heading"><h2 id="highlights-heading" className={styles.highlightsTitle}>今日要点<span>AT A GLANCE</span></h2><ol>{report.body.highlights.map((point, index) => <li key={index}><span className={styles.bullet}>{String(index + 1).padStart(2, "0")}</span><p>{point.text}<Citations ids={point.sourceIds} sources={report.sources} /></p></li>)}</ol></section>}
      {report.body.sections.map((section, index) => <section className={styles.section} key={index}>
        <SectionTitle number={String(index + 1).padStart(2, "0")}>{section.title}</SectionTitle>
        {section.paragraphs.map((paragraph, paragraphIndex) => <p className={styles.paragraph} key={paragraphIndex}>
          {paragraph.kind !== "fact" && <span className={styles.kind}>{paragraph.kind === "analysis" ? "分析" : "待核实"}</span>}
          {paragraph.text}<Citations ids={paragraph.sourceIds} sources={report.sources} />
        </p>)}
      </section>)}
    </>}
    {report.sources.length > 0 && <section className={styles.sources} aria-labelledby="sources-heading">
      <h2 id="sources-heading">参考来源<span>SOURCES</span></h2>
      <ol>{report.sources.map((source, index) => {
        const url = safeSourceUrl(source.url);
        return <li id={`source-${source.id}`} key={source.id}><span className={styles.sourceIndex}>{String(index + 1).padStart(2, "0")}</span><div>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{source.title}<span aria-hidden="true"> ↗</span></a> : <span>{source.title}</span>}<p>{source.siteName}{source.publishedAt && <time dateTime={source.publishedAt}>{formatReportTime(source.publishedAt)}</time>}</p></div></li>;
      })}</ol>
    </section>}
    <section id="original" className={styles.original} aria-labelledby="original-heading">
      <h2 id="original-heading">原始日报<span>ORIGINAL</span></h2>
      {report.original.time && <p className={styles.originalTime}>{report.original.time}</p>}
      <div className={styles.originalContent}>{report.original.content}</div>
    </section>
    <p className={styles.endmark}>— END —</p>
  </article>;
}
