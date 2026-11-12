export type ReportStatus = "idle" | "queued" | "processing" | "completed" | "partial" | "failed";
export type AudioStatus = "not_requested" | "pending" | "ready" | "failed";

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
  audio: { status: AudioStatus; url: string | null; text: string | null };
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

export const AUDIO_STATUS_LABELS: Record<AudioStatus, string> = {
  not_requested: "等待生成语音", pending: "正在生成语音", ready: "可播放语音", failed: "语音暂不可用",
};

export function isAwaitingAudio(status: ReportStatus) {
  // Legacy idle reports are queued automatically by the worker, never by a page request.
  return status === "idle" || status === "queued" || status === "processing";
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
