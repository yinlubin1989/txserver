"use client";

import { useEffect, useState } from "react";
import { isProcessing, type NewsReport } from "../types";

const statuses = new Set(["queued", "processing", "completed", "partial", "failed"]);
const audioStatuses = new Set(["pending", "ready", "failed"]);

function readReportResponse(value: unknown, id: string): NewsReport {
  if (!value || typeof value !== "object") throw new Error("日报接口返回了无效数据。");
  const payload = value as { schemaVersion?: unknown; status?: unknown; report?: NewsReport };
  const report = payload.report;
  if (payload.schemaVersion !== 1 || payload.status !== "completed" || !report || report.schemaVersion !== 1 ||
    report.id !== id || !statuses.has(report.status) || !audioStatuses.has(report.audio?.status) ||
    typeof report.title !== "string" || typeof report.original?.content !== "string" ||
    !Array.isArray(report.sources) || !Array.isArray(report.warnings) ||
    !(report.body === null || (Array.isArray(report.body?.highlights) && Array.isArray(report.body?.sections)))) {
    throw new Error("日报接口返回了无效数据。");
  }
  return report;
}

export function useReport(initialReport: NewsReport) {
  const [report, setReport] = useState(initialReport);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!isProcessing(report.status)) return;
    let disposed = false;
    let nextPoll: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(`/api/news/${report.id}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 404 ? "这份日报已无法访问。" : "暂时无法获取更新，请重试。");
        const updated = readReportResponse(await response.json(), report.id);
        if (disposed) return;
        setReport(updated);
        setError("");
        if (isProcessing(updated.status)) nextPoll = setTimeout(poll, 3000);
      } catch (problem) {
        if (!disposed) setError(problem instanceof Error && problem.name !== "AbortError" ? problem.message : "连接超时，请重试获取更新。");
      } finally { clearTimeout(timeout); }
    }
    nextPoll = setTimeout(poll, retry ? 0 : 3000);
    return () => { disposed = true; controller.abort(); clearTimeout(nextPoll); };
  }, [report.id, report.status, retry]);

  return { report, error, retry: () => { setError(""); setRetry(value => value + 1); } };
}
