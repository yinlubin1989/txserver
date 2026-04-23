import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "漫画照片墙",
  description: "桌面漫画照片合集首页",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
