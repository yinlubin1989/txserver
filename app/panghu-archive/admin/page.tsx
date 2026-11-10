import type { Metadata } from "next";
import { AdminConsole } from "./AdminConsole";

export const metadata: Metadata = {
  title: "消息归档管理 · 胖虎ai",
  description: "私有消息归档管理",
  robots: { index: false, follow: false },
};

export default function ArchiveAdminPage() {
  return <AdminConsole />;
}
