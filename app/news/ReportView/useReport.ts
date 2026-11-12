"use client";

import { useEffect, useRef, useState } from "react";
import { isProcessing, type NewsReport } from "../types";

const statuses = new Set(["idle", "queued", "processing", "completed", "partial", "failed"]);
const audioStatuses = new Set(["not_requested", "pending", "ready", "failed"]);

function readReportResponse(value: unknown, id: string): NewsReport {
  if (!value || typeof value !== "object") throw new Error("日报接口返回了无效数据。");
  const payload = value as { schemaVersion?: unknown; status?: unknown; report?: NewsReport };
  const report = payload.report;
  if (payload.schemaVersion !== 1 || payload.status !== "completed" || !report || report.schemaVersion !== 1 ||
    report.id !== id || !statuses.has(report.status) || !audioStatuses.has(report.audio?.status) ||
    typeof report.title !== "string" || typeof report.original?.content !== "string" ||
    !(report.audio.text === null || typeof report.audio.text === "string") ||
    !(report.audio.url === null || typeof report.audio.url === "string") ||
    (report.audio.status === "ready" && !report.audio.url)) {
    throw new Error("日报接口返回了无效数据。");
  }
  return report;
}

async function readLatestReport(id: string, signal: AbortSignal) {
  const response = await fetch(`/api/news/${id}`, { cache: "no-store", signal });
  if (!response.ok) throw new Error(response.status === 404 ? "这份日报已无法访问。" : "暂时无法获取更新，请重试。");
  return readReportResponse(await response.json(), id);
}

export function useReport(initialReport: NewsReport) {
  const [report, setReport] = useState(initialReport);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [isRequestingAudio, setIsRequestingAudio] = useState(false);
  const requestController = useRef<AbortController | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; requestController.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!isProcessing(report.status)) return;
    let disposed = false;
    let nextPoll: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const updated = await readLatestReport(report.id, controller.signal);
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

  async function requestAudio() {
    if (report.status !== "idle" || requestController.current) return;
    const controller = new AbortController();
    requestController.current = controller;
    setIsRequestingAudio(true);
    setError("");
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/api/news/${report.id}/audio`, { method: "POST", signal: controller.signal });
      if (!response.ok) throw new Error("语音请求暂未确认。");
      const updated = readReportResponse(await response.json(), report.id);
      if (!isMounted.current) return;
      setReport(updated);
      if (updated.status === "idle") setError("尚未开始生成语音，可以再次点击按钮。");
    } catch {
      if (!isMounted.current) return;
      // An uncertain POST is reconciled with one read; never automatically repeat a paid request.
      const checkController = new AbortController();
      requestController.current = checkController;
      const checkTimeout = setTimeout(() => checkController.abort(), 15000);
      try {
        const updated = await readLatestReport(report.id, checkController.signal);
        if (!isMounted.current) return;
        setReport(updated);
        setError(updated.status === "idle" ? "尚未确认语音请求，可以再次点击生成语音。" : "");
      } catch {
        if (isMounted.current) setError("请求结果尚未确认，请刷新状态查看。不会自动重复生成。");
      } finally { clearTimeout(checkTimeout); }
    } finally {
      clearTimeout(timeout);
      requestController.current = null;
      if (isMounted.current) setIsRequestingAudio(false);
    }
  }

  async function refreshStatus() {
    if (requestController.current) return;
    setError("");
    if (isProcessing(report.status)) { setRetry(value => value + 1); return; }
    const controller = new AbortController();
    requestController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const updated = await readLatestReport(report.id, controller.signal);
      if (isMounted.current) setReport(updated);
    } catch {
      if (isMounted.current) setError("暂时无法确认状态，请稍后刷新。");
    } finally { clearTimeout(timeout); requestController.current = null; }
  }

  return { report, error, isRequestingAudio, requestAudio, retry: refreshStatus };
}
