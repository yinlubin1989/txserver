import { BackLink, PageShell, SiteFooter } from "../components/ui/PageKit";

export default function NewsNotFound() {
  return <PageShell width="reading">
    <BackLink href="/news">全部日报</BackLink>
    <div className="py-16"><h1 className="mb-3 text-2xl font-semibold">没有找到这份日报</h1><p className="text-sm text-neutral-500">请检查链接，或返回日报列表。</p></div>
    <SiteFooter />
  </PageShell>;
}
