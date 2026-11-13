"use client";

import { formatReportDate, formatReportTime, isAwaitingAudio, type NewsReport } from "../types";
import { useReport } from "./useReport";
import { AudioPlayer } from "./components/AudioPlayer";
import styles from "./style.module.css";

export function ReportView({ initialReport }: { initialReport: NewsReport }) {
  const { report, error, retry } = useReport(initialReport);

  return <article className={styles.report}>
    <header className={styles.header}>
      <div className={styles.kicker}><span>{report.source === "external" ? "DAILY BRIEF" : report.source}</span><time dateTime={report.reportDate}>{formatReportDate(report.reportDate)}</time></div>
      <h1>{report.title}</h1>
      <p className={styles.updated}>收录于 {formatReportTime(report.createdAt)}<span>北京时间</span></p>
    </header>
    {isAwaitingAudio(report.status) && <p className={styles.audioStatus} role="status">{report.status === "idle" ? "等待生成语音" : "正在生成语音"}，可以先阅读简报。</p>}
    {report.audio.status === "ready" && (report.audio.url ?
      <AudioPlayer key={report.audio.url} url={report.audio.url} transcript={report.audio.text} /> :
      <p className={styles.notice} role="alert">音频地址暂不可用，原始简报仍可阅读。</p>)}
    {error && <div className={styles.notice} role="alert"><p>{error}</p><button type="button" onClick={retry}>刷新状态 →</button></div>}
    {report.audio.status === "failed" && <p className={styles.notice} role="status">语音暂时未能生成，原始简报仍可阅读。</p>}
    <section id="original" className={styles.original} aria-labelledby="original-heading">
      <h2 id="original-heading">原始简报<span>ORIGINAL</span></h2>
      {report.original.time && <p className={styles.originalTime}>{report.original.time}</p>}
      <div className={styles.originalContent}>{report.original.content}</div>
    </section>
    <p className={styles.endmark}>— END —</p>
  </article>;
}
