import type { Metadata } from "next";
import { Suspense } from "react";
import { NotesApp } from "../NotesApp";

export const metadata: Metadata = {
  title: "账本 · Lubin Yin",
  description: "已保存的花店月结单",
};

export default function LedgerPage() {
  return (
    <Suspense fallback={<main className="site-page"><div className="site-container"><p>正在打开账本…</p></div></main>}>
      <NotesApp ledger />
    </Suspense>
  );
}
