import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

const buttonClasses = {
  primary: "site-button-primary",
  secondary: "site-button-secondary",
  danger: "site-button-danger",
};

const statusClasses = {
  info: "site-status-info",
  error: "site-status-error",
  success: "site-status-success",
};

export function PageShell({ children, className = "", width = "wide" }: {
  children: ReactNode;
  className?: string;
  width?: "reading" | "wide";
}) {
  return <main className={`site-page ${className}`}><div className={`site-container ${width === "reading" ? "site-container-reading" : ""}`}>{children}</div></main>;
}

export function BackLink({ href = "/", children = "返回首页" }: { href?: string; children?: ReactNode }) {
  return <Link href={href} className="site-back"><span aria-hidden="true">←</span>{children}</Link>;
}

export function SiteFooter({ className = "" }: { className?: string }) {
  return <footer className={`site-footer ${className}`}><a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">京ICP备2025157289号-2</a></footer>;
}

export function Button({ variant = "primary", className = "", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  return <button type={type} className={`site-button ${buttonClasses[variant]} ${className}`} {...props} />;
}

export function StatusMessage({ children, kind = "info" }: { children: ReactNode; kind?: "info" | "error" | "success" }) {
  return <p role={kind === "error" ? "alert" : "status"} className={`site-status ${statusClasses[kind]}`}>{children}</p>;
}
