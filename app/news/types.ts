export type ReportStatus = "queued" | "processing" | "completed" | "partial" | "failed";
export type AudioStatus = "pending" | "ready" | "failed";

export interface ReportText {
  text: string;
  sourceIds: string[];
}

export interface NewsReport {
  schemaVersion: 1;
  id: string;
  title: string;
  source: "grokbot";
  reportDate: string;
  createdAt: string;
  updatedAt: string;
  status: ReportStatus;
  original: { content: string; time: string };
  body: null | {
    intro: string;
    highlights: ReportText[];
    sections: { title: string; paragraphs: (ReportText & { kind: "fact" | "analysis" | "uncertain" })[] }[];
    voiceScript: string;
  };
  sources: { id: string; url: string; title: string; siteName: string | null; publishedAt: string | null }[];
  warnings: { code: string; message: string }[];
  audio: { status: AudioStatus; url: string | null };
}

export interface ReportListItem {
  id: string;
  title: string;
  source: "grokbot";
  reportDate: string;
  createdAt: string;
  updatedAt: string;
  status: ReportStatus;
  excerpt: string;
  audioStatus: AudioStatus;
}

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  queued: "等待补充", processing: "正在补充", completed: "精读版", partial: "部分完成", failed: "补充未完成",
};

export function isProcessing(status: ReportStatus) {
  return status === "queued" || status === "processing";
}

export function formatReportDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}.${month}.${day}`;
}

export function formatReportTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

export function safeSourceUrl(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
