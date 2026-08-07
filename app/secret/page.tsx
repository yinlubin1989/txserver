import type { Metadata } from "next";
import Link from "next/link";
import SecretWorkbench from "./SecretWorkbench";
import styles from "./secret.module.css";

export const metadata: Metadata = {
  title: "密笺 · 本地中文加密",
  description: "在浏览器本地加密和解密中文，让私密内容只被约定的人读懂。",
};

function ShieldMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8 20 6v5.6c0 4.9-3.1 8.1-8 9.7-4.9-1.6-8-4.8-8-9.7V6l8-3.2Z" />
      <path d="m8.5 12 2.2 2.2 4.8-5" />
    </svg>
  );
}
export default function SecretPage() {
  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="返回首页">
          <span className={styles.brandSeal}>密</span>
          <span>
            <b>密笺</b>
            <small>PRIVATE LETTER</small>
          </span>
        </Link>
        <div className={styles.secureBadge}>
          <ShieldMark />
          <span>
            <b>本地加密</b>
            <small>内容不会上传</small>
          </span>
        </div>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>
          <span>浏览器端到端处理</span>
          <i />
          <span>AES-256-GCM</span>
        </p>
        <h1>
          写给一个人的话，
          <em>不必让世界看懂。</em>
        </h1>
        <p className={styles.intro}>
          输入中文和你们约定的口令，生成一段只有对方能解开的密文。
          <br />
          无需注册，不留记录。
        </p>
      </section>

      <SecretWorkbench />

      <section className={styles.trustStrip} aria-label="安全说明">
        <article>
          <span>01</span>
          <div>
            <h2>只在本机运算</h2>
            <p>明文与口令不经过服务器，刷新页面即离开内存。</p>
          </div>
        </article>
        <article>
          <span>02</span>
          <div>
            <h2>强加密与防篡改</h2>
            <p>AES-256-GCM 加密，PBKDF2-SHA-256 加固口令。</p>
          </div>
        </article>
        <article>
          <span>03</span>
          <div>
            <h2>分开发送更安全</h2>
            <p>密文走聊天工具，口令当面说或换另一种渠道。</p>
          </div>
        </article>
      </section>

      <footer className={styles.footer}>
        <span>密笺 / MIJIAN</span>
        <p>把秘密交给密码学，而不是承诺。</p>
        <Link href="/">返回首页</Link>
      </footer>
    </main>
  );
}
