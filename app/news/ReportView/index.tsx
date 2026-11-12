"use client";

import { formatReportDate, formatReportTime, isProcessing, type NewsReport } from "../types";
import { useReport } from "./useReport";
import { AudioPlayer } from "./components/AudioPlayer";
import styles from "./style.module.css";

export function ReportView({ initialReport }: { initialReport: NewsReport }) {
  const { report, error, retry, isRequestingAudio, requestAudio } = useReport(initialReport);
  const processing = isProcessing(report.status);
  const isGenerating = processing || isRequestingAudio;

  return <article className={styles.report}>
    <header className={styles.header}>
      <div className={styles.kicker}><span>GROKBOT / DAILY BRIEF</span><time dateTime={report.reportDate}>{formatReportDate(report.reportDate)}</time></div>
      <h1>{report.title}</h1>
      <p className={styles.updated}>收录于 {formatReportTime(report.createdAt)}<span>北京时间</span></p>
    </header>
    {(report.status === "idle" || isGenerating) && <div className={styles.audioAction}>
      <button type="button" onClick={requestAudio} disabled={isGenerating}>
        {isGenerating ? "正在生成语音" : "生成语音"}<span aria-hidden="true">→</span>
      </button>
      <p role={isGenerating ? "status" : undefined}>{isGenerating ? "可以先阅读简报，语音生成后会自动显示。" : "朗读简报正文，生成后保存，再次播放无需生成。"}</p>
    </div>}
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
