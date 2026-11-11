"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { deleteBill, listBills, listPublicBills, setVisibility } from "../api";
import { mergeBills, presentBill, type PresentedBill } from "../present";
import styles from "../style.module.css";

type Scope = "mine" | "public";
type Action = "public" | "private" | "delete";

export function LedgerView() {
  const [scope, setScope] = useState<Scope>("mine");
  const [bills, setBills] = useState<PresentedBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState("");
  const [loadMoreError, setLoadMoreError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [menuBill, setMenuBill] = useState<PresentedBill | null>(null);
  const [confirm, setConfirm] = useState<{ bill: PresentedBill; action: Action } | null>(null);
  const [requestId, setRequestId] = useState(0);
  const requestSeq = useRef(0);

  useEffect(() => {
    const sequence = ++requestSeq.current;
    let cancelled = false;
    const pending = scope === "public" ? listPublicBills(null) : listBills(null);
    pending.then((result) => {
      if (cancelled || sequence !== requestSeq.current) return;
      setBills(result.bills.map(presentBill));
      setNextCursor(result.nextCursor);
      setHasLoaded(true);
    }).catch((reason: unknown) => {
      if (cancelled || sequence !== requestSeq.current) return;
      setError(reason instanceof Error ? reason.message : "账本暂时无法读取，请稍后重试。");
    }).finally(() => {
      if (!cancelled && sequence === requestSeq.current) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [scope, requestId]);

  async function loadMore() {
    if (busyId || loading || loadingMore || !hasLoaded || nextCursor === null || error) return;
    setLoadingMore(true);
    setLoadMoreError("");
    try {
      const result = scope === "public" ? await listPublicBills(nextCursor) : await listBills(nextCursor);
      setBills((current) => mergeBills(current, result.bills.map(presentBill)));
      setNextCursor(result.nextCursor);
    } catch (reason) {
      setLoadMoreError(reason instanceof Error ? reason.message : "账本暂时无法读取，请稍后重试。");
    } finally {
      setLoadingMore(false);
    }
  }

  function switchScope(next: Scope) {
    if (next === scope || busyId) return;
    setScope(next);
    setBills([]);
    setNextCursor(null);
    setHasLoaded(false);
    setLoading(true);
    setLoadingMore(false);
    setError("");
    setLoadMoreError("");
    setNotice("");
    setMenuBill(null);
    setConfirm(null);
  }

  async function applyAction() {
    if (!confirm) return;
    const { bill, action } = confirm;
    setConfirm(null);
    setBusyId(bill.id);
    try {
      if (action === "delete") await deleteBill(bill.id);
      else await setVisibility(bill.id, action);
      setBills((current) => action === "delete"
        ? current.filter((item) => item.id !== bill.id)
        : current.map((item) => item.id === bill.id ? { ...item, visibility: action, visibilityLabel: action === "public" ? "公开" : "私有" } : item));
      setNotice(action === "delete" ? "账单已删除" : action === "public" ? "已设为公开" : "已设为私有");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "操作失败，请重试。");
    } finally {
      setBusyId("");
    }
  }

  const confirmCopy = confirm?.action === "delete"
    ? "账单将从记事本移除，已发出的分享链接也会失效。此操作无法撤销。"
    : confirm?.action === "public"
      ? "所有用户都能在公开账单列表中查看这张账单，也可通过分享链接查看；不包含完整记账原文。"
      : "仅你可以查看，账单将从公开列表移除，之前发出的分享链接将失效。再次公开后需重新分享。";

  return (
    <div className={styles.ledgerPage}>
      <header className={styles.pageHead}>
        <div>
          <p className={styles.kicker}>LEDGER</p>
          <h1 className={styles.pageTitle}>账本</h1>
          <p className={styles.lede}>已保存的月结单。公开的账单所有人都能打开。</p>
        </div>
        <Link href="/notes" className={styles.headerLink}>去统计 <span aria-hidden="true">→</span></Link>
      </header>
      <div className={styles.ledgerTabs} role="tablist" aria-label="账单范围">
        <button type="button" className={`${styles.ledgerTab} ${scope === "mine" ? styles.ledgerTabActive : ""}`} role="tab" aria-selected={scope === "mine"} disabled={!!busyId} onClick={() => switchScope("mine")}>我的账单</button>
        <button type="button" className={`${styles.ledgerTab} ${scope === "public" ? styles.ledgerTabActive : ""}`} role="tab" aria-selected={scope === "public"} disabled={!!busyId} onClick={() => switchScope("public")}>公开账单</button>
      </div>
      <div className={styles.ledgerMeta}>
        <span>{loading && hasLoaded ? "正在刷新…" : scope === "public" ? "所有用户 · 最近保存" : "最近保存"}</span>
        {hasLoaded ? <span>{nextCursor === null ? "共 " : "已加载 "}{bills.length} 张账单</span> : null}
      </div>
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {loading && !hasLoaded ? (
        <div className={styles.status}><div className={styles.billSkeleton} aria-hidden="true"><span /><span /><span /></div><span>正在读取账本…</span></div>
      ) : null}
      {error ? (
        <div className={styles.errorPanel}>
          <p className={styles.errorMessage} role="alert">{error}</p>
          {bills.length ? <span className={styles.errorCaption}>当前仍显示上次加载的账单。</span> : null}
          <button type="button" className={`${styles.utilityButton} ${styles.retryButton}`} onClick={() => { setLoading(true); setError(""); setLoadMoreError(""); setRequestId((value) => value + 1); }} disabled={loading}>重新加载</button>
        </div>
      ) : null}
      {hasLoaded && !loading && !error && bills.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>{scope === "public" ? "暂无公开账单" : "账本还是空的"}</div>
          <p className={styles.emptyCaption}>{scope === "public" ? "设为公开的账单会出现在这里。" : "统计完成后，第一张月结单会出现在这里。"}</p>
        </div>
      ) : null}
      {bills.length ? (
        <div>
          {bills.map((bill) => (
            <article className={styles.savedBill} key={bill.id}>
              <Link className={styles.billContent} href={scope === "public" ? `/notes?publicBillId=${bill.id}` : `/notes?billId=${bill.id}`} aria-label={`查看${bill.title}`} aria-disabled={!!busyId} onClick={(event) => { if (busyId) event.preventDefault(); }}>
                <div className={styles.billHeading}>
                  <span className={styles.billTitle}>{bill.title}</span>
                  <span className={styles.savedTime}>{bill.savedAt}</span>
                </div>
                <div className={styles.billTotals}>
                  <div><span className={styles.totalLabel}>收入</span><span className={`${styles.number} ${styles.totalAmount}`}>{bill.income}</span></div>
                  <div><span className={styles.totalLabel}>支出</span><span className={`${styles.number} ${styles.totalAmount}`}>{bill.expense}</span></div>
                  <div className={styles.profitTotal}><span className={styles.totalLabel}>利润</span><span className={`${styles.number} ${styles.totalAmount}`}>{bill.profit}</span></div>
                </div>
                {bill.reviewCount > 0 ? <div className={styles.billFooter}><span className={styles.reviewNote}><span className={styles.reviewIcon}>!</span><span>{bill.reviewCount} 项待核对</span></span></div> : null}
              </Link>
              {scope === "mine" ? (
                <button type="button" className={styles.billManage} disabled={!!busyId || loading || loadingMore} aria-label={`管理${bill.title}，当前${bill.visibilityLabel}`} onClick={() => { setNotice(""); setMenuBill(bill); }}>
                  <span>{busyId === bill.id ? "处理中" : bill.visibilityLabel}</span>
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
      {bills.length && !error ? (
        <div className={styles.pagination}>
          {loadingMore ? <span className={styles.paginationCaption}>正在读取更多账单…</span> : loadMoreError ? (
            <><span className={styles.paginationError}>{loadMoreError}</span><button type="button" className={styles.utilityButton} onClick={loadMore}>重试加载</button></>
          ) : nextCursor !== null ? (
            <button type="button" className={styles.utilityButton} onClick={loadMore} disabled={loading}>加载更多账单</button>
          ) : !loading ? <span className={styles.paginationCaption}>已显示全部账单</span> : null}
        </div>
      ) : null}
      <p className={styles.ledgerFooter}>{scope === "public" ? "公开账单仅供查看 · 管理请到我的账单" : "账单保存在云端 · 此浏览器可管理自己保存的账单"}</p>
      {menuBill ? (
        <div className={styles.shareOverlay}>
          <button type="button" className={styles.shareBackdrop} aria-label="关闭" onClick={() => setMenuBill(null)} />
          <div className={styles.shareSheet} role="dialog" aria-label={`管理${menuBill.title}`}>
            <h2 className={styles.shareTitle}>{menuBill.title}</h2>
            <div className={styles.menuActions}>
              <button type="button" className={`${styles.primaryButton} ${styles.sheetButton}`} onClick={() => { setConfirm({ bill: menuBill, action: menuBill.visibility === "public" ? "private" : "public" }); setMenuBill(null); }}>{menuBill.visibility === "public" ? "设为私有" : "设为公开"}</button>
              <button type="button" className={`${styles.secondaryButton} ${styles.sheetButton} ${styles.dangerButton}`} onClick={() => { setConfirm({ bill: menuBill, action: "delete" }); setMenuBill(null); }}>删除账单</button>
              <button type="button" className={`${styles.textButton} ${styles.shareCancel}`} onClick={() => setMenuBill(null)}>取消</button>
            </div>
          </div>
        </div>
      ) : null}
      {confirm ? (
        <div className={styles.shareOverlay}>
          <button type="button" className={styles.shareBackdrop} aria-label="取消" onClick={() => setConfirm(null)} />
          <div className={styles.shareSheet} role="dialog" aria-label={confirm.action === "delete" ? `删除${confirm.bill.title}` : confirm.action === "public" ? "设为公开" : "设为私有"}>
            <h2 className={styles.shareTitle}>{confirm.action === "delete" ? `删除${confirm.bill.title}？` : confirm.action === "public" ? "设为公开？" : "设为私有？"}</h2>
            <p className={styles.confirmCopy}>{confirmCopy}</p>
            <button type="button" className={`${styles.primaryButton} ${styles.sheetButton}`} onClick={applyAction}>{confirm.action === "delete" ? "删除" : confirm.action === "public" ? "设为公开" : "设为私有"}</button>
            <button type="button" className={`${styles.textButton} ${styles.shareCancel}`} onClick={() => setConfirm(null)}>取消</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
