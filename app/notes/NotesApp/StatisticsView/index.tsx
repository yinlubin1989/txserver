"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { calculateStatistics, createShare, getBill, getPublicBill, getSharedBill, saveBill } from "../api";
import { presentReport, type PresentedReport } from "../present";
import { Receipt } from "../Receipt";
import styles from "../style.module.css";

const PLACEHOLDER = "粘贴你的记账文字，例如：\n\n10月1日\n368元花束 2束，736元\n288元花束 1束，288元\n收入合计：1024元\n支出：红包160元，进货320元";

export type StatisticsTarget =
  | { kind: "compose" }
  | { kind: "invalid"; message: string }
  | { kind: "owner"; id: string }
  | { kind: "public"; id: string }
  | { kind: "share"; token: string };

function viewKey(target: StatisticsTarget) {
  if (target.kind === "owner") return `owner:${target.id}`;
  if (target.kind === "public") return `public:${target.id}`;
  if (target.kind === "share") return `share:${target.token}`;
  if (target.kind === "invalid") return `invalid:${target.message}`;
  return "compose";
}

function requestId() {
  return `bill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function StatisticsView({ target }: { target: StatisticsTarget }) {
  const router = useRouter();
  const sharedView = target.kind === "public" || target.kind === "share";
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(target.kind === "invalid" ? target.message : "");
  const [report, setReport] = useState<PresentedReport | null>(null);
  const [showInput, setShowInput] = useState(target.kind === "compose");
  const [savedBillId, setSavedBillId] = useState("");
  const [savedVisibility, setSavedVisibility] = useState<"private" | "public" | null>(null);
  const [saveError, setSaveError] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loadingBill, setLoadingBill] = useState(target.kind === "owner" || target.kind === "public" || target.kind === "share");
  const [canRetry, setCanRetry] = useState(target.kind === "owner" || target.kind === "public" || target.kind === "share");
  const [reloadKey, setReloadKey] = useState(0);
  const [shareToken, setShareToken] = useState("");
  const rawReport = useRef<unknown>(null);
  const displayedKey = useRef("");
  const revision = useRef(0);
  const snapshotRequestId = useRef("");
  const defaultPublic = useRef(false);
  const savingRef = useRef(false);
  const disposed = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const submitSeq = useRef(0);
  const confirmResolve = useRef<((value: boolean) => void) | null>(null);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      requestRef.current?.abort();
      confirmResolve.current?.(false);
    };
  }, []);

  useEffect(() => {
    if (target.kind === "compose") return;
    if (displayedKey.current === viewKey(target) && rawReport.current) return;
    const current = ++revision.current;
    let cancelled = false;
    const begin = () => {
      if (target.kind === "invalid") {
        setShowInput(false);
        setError(target.message);
        setReport(null);
        setCanRetry(false);
        setLoadingBill(false);
        return;
      }
      setLoadingBill(true);
      setError("");
      setSaveError("");
      setReport(null);
      setShareToken("");
      setShareOpen(false);
      setCanRetry(true);
    };
    begin();
    if (target.kind === "invalid") return;
    const show = (reportPayload: unknown) => {
      const presented = presentReport(reportPayload);
      rawReport.current = reportPayload;
      displayedKey.current = viewKey(target);
      setReport(presented);
      setShowInput(false);
    };
    const load = async () => {
      if (target.kind === "public" || target.kind === "share") {
        const bill = target.kind === "public" ? await getPublicBill(target.id) : await getSharedBill(target.token);
        if (cancelled || current !== revision.current) return;
        show(bill.report);
        setText("");
        setSavedBillId("");
        setSavedVisibility(null);
        return;
      }
      const bill = await getBill(target.id);
      if (cancelled || current !== revision.current) return;
      show(bill.report);
      setText(bill.text);
      setSavedBillId(bill.id);
      setSavedVisibility(bill.visibility);
      if (bill.visibility !== "public") return;
      try {
        const token = await createShare(bill.id);
        if (!cancelled && current === revision.current) setShareToken(token);
      } catch {
        if (!cancelled && current === revision.current) setSaveError("分享暂未准备好，请点击“分享账单”重试。");
      }
    };
    load().catch((reason: unknown) => {
      if (!cancelled && current === revision.current) setError(reason instanceof Error ? reason.message : "账单暂时无法打开，请重试。");
    }).finally(() => {
      if (!cancelled && current === revision.current) setLoadingBill(false);
    });
    return () => { cancelled = true; };
  }, [target, reloadKey]);

  function invalidateReport() {
    revision.current += 1;
    rawReport.current = null;
    displayedKey.current = "";
    snapshotRequestId.current = "";
    defaultPublic.current = false;
    setReport(null);
    setSavedBillId("");
    setSavedVisibility(null);
    setShareToken("");
    setShareOpen(false);
    setSaveError("");
    setCanRetry(false);
    if (target.kind !== "compose") router.replace("/notes", { scroll: false });
  }

  function closeConfirm(accepted: boolean) {
    setConfirmOpen(false);
    confirmResolve.current?.(accepted);
    confirmResolve.current = null;
  }

  function askToPublish() {
    return new Promise<boolean>((resolve) => {
      confirmResolve.current = resolve;
      setConfirmOpen(true);
    });
  }

  async function persistBill(andShare: boolean, automatic = false) {
    if (savingRef.current || sharedView || !rawReport.current) return;
    const current = revision.current;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    let savedId = savedBillId;
    try {
      let visibility = savedVisibility;
      if (!savedId) {
        defaultPublic.current = true;
        if (!snapshotRequestId.current) snapshotRequestId.current = requestId();
        const bill = await saveBill({ report: rawReport.current, text, clientRequestId: snapshotRequestId.current });
        if (disposed.current || current !== revision.current) return;
        presentReport(bill.report);
        savedId = bill.id;
        visibility = bill.visibility;
        displayedKey.current = `owner:${savedId}`;
        setSavedBillId(savedId);
        setSavedVisibility(visibility);
        router.replace(`/notes?billId=${savedId}`, { scroll: false });
      }
      if (andShare || defaultPublic.current || visibility === "public") {
        if (visibility !== "public" && !defaultPublic.current) {
          const confirmed = await askToPublish();
          if (!confirmed || disposed.current || current !== revision.current) return;
        }
        const token = shareToken || await createShare(savedId);
        if (disposed.current || current !== revision.current) return;
        defaultPublic.current = false;
        setShareToken(token);
        setSavedVisibility("public");
        if (andShare) setShareOpen(true);
      }
    } catch (reason) {
      if (!disposed.current && current === revision.current) {
        const prefix = savedId ? "账单已保存，分享暂未准备好。" : automatic ? "自动保存未完成，请点击保存重试。" : "";
        setSaveError(prefix + (reason instanceof Error ? reason.message : "保存失败，请重试。"));
      }
    } finally {
      savingRef.current = false;
      if (!disposed.current) setSaving(false);
    }
  }

  async function submit() {
    if (loading || saving || sharedView) return;
    if (!text.trim()) { setError("请先粘贴记账文案。"); return; }
    invalidateReport();
    const current = ++submitSeq.current;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 60000);
    setLoading(true);
    setError("");
    setReport(null);
    let payload: unknown = null;
    try {
      payload = await calculateStatistics(text, controller.signal);
      if (disposed.current || current !== submitSeq.current) return;
      let presented: PresentedReport;
      try { presented = presentReport(payload); }
      catch { setError("统计结果格式异常，请重试。"); return; }
      rawReport.current = payload;
      snapshotRequestId.current = requestId();
      setReport(presented);
      setShowInput(false);
    } catch (reason) {
      if (disposed.current || current !== submitSeq.current) return;
      const aborted = reason instanceof DOMException && reason.name === "AbortError";
      setError(aborted || !(reason instanceof Error) ? "请求未完成，请检查网络后重试。原文已保留。" : reason.message);
    } finally {
      window.clearTimeout(timer);
      if (requestRef.current === controller) requestRef.current = null;
      if (!disposed.current && current === submitSeq.current) setLoading(false);
    }
    if (payload && rawReport.current && !disposed.current && current === submitSeq.current) await persistBill(false, true);
  }

  async function paste() {
    if (loading || saving || sharedView) return;
    try {
      const data = await navigator.clipboard.readText();
      if (data.length > 20000) { setError("文案超过20,000字符，请按月整理后再粘贴。"); return; }
      invalidateReport();
      setText(data);
      setError(data.trim() ? "" : "剪贴板中没有文字。");
      setShowInput(true);
    } catch {
      setError("无法读取剪贴板，请长按输入框手动粘贴。");
    }
  }

  const shareUrl = savedBillId && typeof window !== "undefined" ? `${window.location.origin}/notes?publicBillId=${savedBillId}` : "";

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
      setSaveError("无法写入剪贴板，请长按链接手动复制。");
    }
  }

  return (
    <div className={`${styles.page} ${report ? styles.pageHasReport : ""}`}>
      {report ? (
        sharedView ? null : (
          <div className={styles.compactBar}>
            <Link href="/notes/ledger" className={styles.headerLink} aria-disabled={saving} onClick={(event) => { if (saving) event.preventDefault(); }}>账本 <span aria-hidden="true">→</span></Link>
          </div>
        )
      ) : (
        <header className={styles.pageHead}>
          <div>
            <p className={styles.kicker}>NOTES</p>
            <h1 className={styles.pageTitle}>记事本</h1>
            <p className={styles.lede}>粘贴一个月的记账文字，生成花店月结单。</p>
          </div>
          {sharedView ? null : <Link href="/notes/ledger" className={styles.headerLink} aria-disabled={saving} onClick={(event) => { if (saving) event.preventDefault(); }}>账本 <span aria-hidden="true">→</span></Link>}
        </header>
      )}
      {loadingBill ? <p className={styles.loadingState}>正在打开账单…</p> : null}
      {!sharedView && !loadingBill && showInput ? (
        <div className={styles.inputPanel}>
          <div className={styles.inputPaper}>
            <div className={styles.sheetHead}><span>记账原文</span><span className={styles.number}>{text.length.toLocaleString("en-US")} / 20,000</span></div>
            <div className={styles.inputEditor}>
              {text ? null : <div className={styles.inputPlaceholder} aria-hidden="true">{PLACEHOLDER}</div>}
              <textarea className={styles.ledgerInput} value={text} maxLength={20000} disabled={loading || saving} aria-label="记账原文，可粘贴或输入本月的记账文字" onChange={(event) => {
                if (loading || saving || sharedView || event.target.value === text) return;
                invalidateReport();
                setText(event.target.value);
                setError("");
              }} />
            </div>
            <div className={styles.sheetFoot}>
              <p className={styles.publishHint}>统计后自动保存为公开账单，所有用户可见。</p>
              <div className={styles.inputActions}>
                <button type="button" className={styles.secondaryButton} onClick={paste} disabled={loading || saving}>粘贴</button>
                <button type="button" className={styles.primaryButton} onClick={submit} disabled={loading || saving}>{loading ? "正在识别并核算…" : "开始统计"}{loading ? null : <span aria-hidden="true">→</span>}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className={styles.errorMessage} role="alert">
          <p>{error}</p>
          {canRetry && !loading && !loadingBill && !report && !showInput ? <button type="button" className={`${styles.utilityButton} ${styles.retryButton}`} onClick={() => { rawReport.current = null; displayedKey.current = ""; setLoadingBill(true); setError(""); setReport(null); setReloadKey((value) => value + 1); }}>重新加载</button> : null}
        </div>
      ) : null}
      {report ? (
        <>
          <Receipt
            report={report}
            sharedView={sharedView}
            showInput={showInput}
            loading={loading}
            saving={saving}
            onToggleInput={() => { if (!sharedView && !saving) setShowInput((value) => !value); }}
            onToggleIncome={() => setReport((current) => current ? { ...current, incomeExpanded: !current.incomeExpanded } : current)}
            onToggleExpense={() => setReport((current) => current ? { ...current, expenseExpanded: !current.expenseExpanded } : current)}
            onToggleWarnings={() => setReport((current) => current ? { ...current, warningsExpanded: !current.warningsExpanded } : current)}
            onToggleDay={(index) => setReport((current) => current?.rows[index] ? { ...current, rows: current.rows.map((row, rowIndex) => rowIndex === index ? { ...row, expanded: !row.expanded } : row) } : current)}
          />
          {sharedView ? null : (
            <div className={styles.receiptActions}>
              <div className={styles.actionButtons}>
                <button type="button" className={styles.secondaryButton} onClick={() => persistBill(false)} disabled={saving || loading}>{savedBillId ? "已保存" : "保存"}</button>
                <button type="button" className={styles.primaryButton} onClick={() => persistBill(true)} disabled={saving || loading}>{savedBillId ? "分享账单" : "保存并分享"}</button>
              </div>
              {saveError ? <p className={styles.saveError} role="alert">{saveError}</p> : null}
              <div className={styles.saveStatus}>
                <span>{saving ? "正在保存并准备分享…" : savedBillId ? (savedVisibility === "public" ? "已保存 · 所有用户可见，可在账本改为私有" : "已保存 · 私有") : "尚未保存，请点击保存重试"}</span>
                {savedBillId ? <Link href="/notes/ledger" className={styles.textButton} onClick={(event) => { if (saving) event.preventDefault(); }}>查看账本 <span aria-hidden="true">→</span></Link> : null}
              </div>
            </div>
          )}
        </>
      ) : null}
      {shareOpen && savedBillId ? (
        <div className={styles.shareOverlay}>
          <button type="button" className={styles.shareBackdrop} aria-label="关闭分享" onClick={() => setShareOpen(false)} />
          <div className={styles.shareSheet} role="dialog" aria-label="分享账单">
            <div className={styles.shareHeading}>
              <div><h2 className={styles.shareTitle}>账单已保存</h2><p className={styles.shareCaption}>打开链接可查看这张完整月结单。</p></div>
              <button type="button" className={styles.textButton} onClick={() => setShareOpen(false)}>关闭</button>
            </div>
            <div className={styles.shareSummary}><div>{report?.title} · {report?.days} 天记录</div><div className={styles.shareProfit}><span>利润</span><span className={styles.number}>¥ {report?.displayTotals.profit}</span></div></div>
            <input className={styles.shareLink} readOnly value={shareUrl} aria-label="账单链接" onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className={`${styles.primaryButton} ${styles.sheetButton}`} onClick={copyLink}>{copied ? "链接已复制" : "复制链接"}</button>
            <button type="button" className={`${styles.textButton} ${styles.shareCancel}`} onClick={() => setShareOpen(false)}>暂不分享</button>
          </div>
        </div>
      ) : null}
      {confirmOpen ? (
        <div className={styles.shareOverlay}>
          <button type="button" className={styles.shareBackdrop} aria-label="取消" onClick={() => closeConfirm(false)} />
          <div className={styles.shareSheet} role="dialog" aria-label="设为公开并分享">
            <h2 className={styles.shareTitle}>设为公开并分享？</h2>
            <p className={styles.confirmCopy}>所有用户都能在公开账单列表和分享链接中查看这张账单。你可以在记事本中改为私有，同时撤下公开列表并使旧链接失效。</p>
            <button type="button" className={`${styles.primaryButton} ${styles.sheetButton}`} onClick={() => closeConfirm(true)}>公开分享</button>
            <button type="button" className={`${styles.textButton} ${styles.shareCancel}`} onClick={() => closeConfirm(false)}>取消</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
