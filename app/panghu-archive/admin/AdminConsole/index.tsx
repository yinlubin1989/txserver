"use client";

import { useState } from "react";
import type { ArchiveRecord } from "./api";
import { useArchiveAdmin } from "./useArchiveAdmin";
import styles from "./style.module.css";

const SOURCE_LABELS: Record<ArchiveRecord["source"], string> = {
  incoming: "收到消息",
  auto_reply: "自动回复",
  manual_reply: "手动回复",
  outbound: "主动发送",
};
const STATUS_LABELS: Record<ArchiveRecord["status"], string> = {
  received: "已接收",
  sent: "已发送",
  unknown: "结果未知",
};
const formatTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });

export function AdminConsole() {
  const admin = useArchiveAdmin();
  const [password, setPassword] = useState("");

  if (admin.session !== "authenticated") {
    return (
      <main className={styles.loginPage}>
        <section className={styles.loginPanel}>
          <p className={styles.brand}>胖虎ai</p>
          <h1>消息归档管理</h1>
          {admin.session === "checking" ? (
            <p role="status" className={styles.muted}>
              正在检查登录状态…
            </p>
          ) : admin.session === "error" ? (
            <>
              <p className={styles.error} role="alert">
                {admin.error}
              </p>
              <button className={styles.primary} onClick={admin.retrySession}>
                重试
              </button>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const value = password;
                setPassword("");
                void admin.login(value);
              }}
            >
              <label>
                管理员密码
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={admin.busy !== null}
                />
              </label>
              {admin.error && (
                <p className={styles.error} role="alert">
                  {admin.error}
                </p>
              )}
              <button
                className={styles.primary}
                disabled={admin.busy !== null || !password}
              >
                {admin.busy === "login" ? "登录中…" : "登录"}
              </button>
            </form>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <p className={styles.brand}>胖虎ai</p>
            <h1>消息归档</h1>
          </div>
          <button
            className={styles.secondary}
            disabled={admin.busy === "logout"}
            onClick={() => void admin.logout()}
          >
            {admin.busy === "logout" ? "退出中…" : "退出登录"}
          </button>
        </header>
        <form
          className={styles.filters}
          onSubmit={(event) => {
            event.preventDefault();
            admin.applyFilters();
          }}
        >
          <label>
            账号
            <input
              placeholder="corpId:userId"
              maxLength={512}
              value={admin.filters.profile}
              disabled={admin.busy === "logout"}
              onChange={(event) =>
                admin.changeFilters({
                  ...admin.filters,
                  profile: event.target.value,
                })
              }
            />
          </label>
          <label>
            联系人 ID
            <input
              placeholder="openDingtalkId"
              maxLength={256}
              value={admin.filters.peerId}
              disabled={admin.busy === "logout"}
              onChange={(event) =>
                admin.changeFilters({
                  ...admin.filters,
                  peerId: event.target.value,
                })
              }
            />
          </label>
          <label>
            开始时间（本地）
            <input
              type="datetime-local"
              step="1"
              value={admin.filters.from}
              disabled={admin.busy === "logout"}
              onChange={(event) =>
                admin.changeFilters({
                  ...admin.filters,
                  from: event.target.value,
                })
              }
            />
          </label>
          <label>
            结束时间（本地）
            <input
              type="datetime-local"
              step="1"
              value={admin.filters.to}
              disabled={admin.busy === "logout"}
              onChange={(event) =>
                admin.changeFilters({
                  ...admin.filters,
                  to: event.target.value,
                })
              }
            />
          </label>
          <button className={styles.primary} disabled={admin.busy !== null}>
            筛选
          </button>
        </form>
        {admin.error && (
          <div className={styles.errorBar} role="alert">
            <span>{admin.error}</span>
            <button
              className={styles.secondary}
              disabled={admin.busy !== null}
              onClick={admin.retryRecords}
            >
              重试
            </button>
          </div>
        )}
        <section
          className={styles.records}
          aria-label="归档消息"
          aria-busy={admin.busy === "records"}
        >
          {admin.busy === "records" ? (
            <p className={styles.empty} role="status">
              正在加载…
            </p>
          ) : admin.records.length === 0 ? (
            <p className={styles.empty}>
              {admin.loaded
                ? "暂无符合条件的消息"
                : admin.error
                  ? "记录暂不可用"
                  : "点击筛选查看记录"}
            </p>
          ) : (
            admin.records.map((record) => (
              <article
                className={styles.record}
                key={`${record.ownerId}:${record.id}`}
              >
                <div className={styles.recordHeading}>
                  <h2>{record.peerName || record.peerId}</h2>
                  <time dateTime={record.occurredAt}>
                    {formatTime(record.occurredAt)}
                  </time>
                </div>
                <p className={styles.identity}>
                  账号 {record.profile} · 联系人 {record.peerId}
                </p>
                <div className={styles.tags}>
                  <span>
                    {record.direction === "incoming" ? "接收" : "发出"}
                  </span>
                  <span>{SOURCE_LABELS[record.source]}</span>
                  <span
                    className={
                      record.status === "unknown" ? styles.unknown : undefined
                    }
                  >
                    {STATUS_LABELS[record.status]}
                  </span>
                </div>
                <p className={styles.message}>
                  {record.text || "（无文本内容）"}
                </p>
                <p className={styles.archiveMeta}>
                  归档 {record.ownerId} · {formatTime(record.archivedAt)}
                </p>
              </article>
            ))
          )}
        </section>
        <nav className={styles.pagination} aria-label="消息分页">
          <button
            className={styles.secondary}
            disabled={admin.busy !== null || admin.page === 1}
            onClick={admin.previous}
          >
            上一页
          </button>
          <span>
            第 {admin.page} 页
            {admin.loaded ? ` · ${admin.records.length} 条` : ""}
          </span>
          <button
            className={styles.secondary}
            disabled={admin.busy !== null || admin.nextCursor === null}
            onClick={admin.next}
          >
            下一页
          </button>
        </nav>
      </div>
    </main>
  );
}
