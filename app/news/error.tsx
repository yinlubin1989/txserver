"use client";

import { BackLink, Button, PageShell, SiteFooter } from "../components/ui/PageKit";

export default function NewsError({ reset }: { reset: () => void }) {
  return <PageShell width="reading">
    <BackLink href="/news">全部日报</BackLink>
    <div className="py-16" role="alert"><h1 className="mb-3 text-2xl font-semibold">日报暂时无法打开</h1><p className="mb-6 text-sm text-neutral-500">读取内容时遇到问题，请稍后重试。</p><Button variant="secondary" onClick={reset}>重新加载</Button></div>
    <SiteFooter />
  </PageShell>;
}
