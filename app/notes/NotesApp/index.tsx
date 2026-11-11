"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { BackLink, PageShell, SiteFooter } from "@/app/components/ui/PageKit";
import { LedgerView } from "./LedgerView";
import { StatisticsView, type StatisticsTarget } from "./StatisticsView";
import styles from "./style.module.css";

const ID_PATTERN = /^[a-f0-9]{24}$/;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function parseTarget(billId: string | null, publicBillId: string | null, share: string | null, unavailable: boolean): StatisticsTarget {
  const selected = [billId !== null, publicBillId !== null, share !== null].filter(Boolean).length;
  if (unavailable || selected > 1) return { kind: "invalid", message: "这张账单尚未准备好，请让分享者保存后重新分享。" };
  if (share !== null) return TOKEN_PATTERN.test(share) ? { kind: "share", token: share } : { kind: "invalid", message: "账单地址无效，请获取新的账单链接。" };
  if (publicBillId !== null) return ID_PATTERN.test(publicBillId) ? { kind: "public", id: publicBillId } : { kind: "invalid", message: "账单地址无效，请获取新的账单链接。" };
  if (billId !== null) return ID_PATTERN.test(billId) ? { kind: "owner", id: billId } : { kind: "invalid", message: "账单地址无效，请获取新的账单链接。" };
  return { kind: "compose" };
}

export function NotesApp({ ledger = false }: { ledger?: boolean }) {
  const search = useSearchParams();
  const billId = search.get("billId");
  const publicBillId = search.get("publicBillId");
  const share = search.get("share");
  const unavailable = search.has("unavailable");
  const target = useMemo(() => parseTarget(billId, publicBillId, share, unavailable), [billId, publicBillId, share, unavailable]);

  return (
    <PageShell>
      <BackLink />
      <div className={styles.finance}>
        {ledger ? <LedgerView /> : <StatisticsView target={target} />}
      </div>
      <SiteFooter />
    </PageShell>
  );
}
