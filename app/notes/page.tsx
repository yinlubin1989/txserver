import type { Metadata } from "next";
import { Suspense } from "react";
import { NotesApp } from "./NotesApp";

export const metadata: Metadata = {
  title: "记事本 · Lubin Yin",
  description: "粘贴记账文字，统计花店月结单",
};

export default function NotesPage() {
  return (
    <Suspense fallback={<main className="site-page"><div className="site-container"><p>正在打开记事本…</p></div></main>}>
      <NotesApp />
    </Suspense>
  );
}
