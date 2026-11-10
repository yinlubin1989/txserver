"use client";

import { useState } from "react";
import { useArchiveAdmin } from "./useArchiveAdmin";
import { Inbox } from "./Inbox";
import styles from "./style.module.css";

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
        {admin.error && (
          <div className={styles.errorBar} role="alert">
            {admin.error}
          </div>
        )}
        <div className={styles.workspace}>
          <aside
            className={styles.accounts}
            aria-label="用户列表"
            aria-busy={admin.loadingAccounts}
          >
            <div className={styles.accountsHeading}>
              <h2>用户</h2>
              <button
                className={styles.textButton}
                disabled={admin.busy !== null || admin.loadingAccounts}
                onClick={admin.refreshAccounts}
              >
                刷新用户
              </button>
            </div>
            <ul className={styles.accountList}>
              {admin.accounts.map((account) => (
                <li key={account.profile}>
                  <button
                    className={`${styles.account} ${admin.selected?.profile === account.profile ? styles.accountSelected : ""}`}
                    aria-label={`选择用户 ${account.displayName ?? account.profile}`}
                    aria-pressed={admin.selected?.profile === account.profile}
                    disabled={admin.busy === "logout"}
                    onClick={() => admin.selectAccount(account.profile)}
                  >
                    <strong>{account.displayName ?? account.profile}</strong>
                    {account.displayName && (
                      <span className={styles.accountProfile}>
                        {account.profile}
                      </span>
                    )}
                    <span className={styles.accountMeta}>
                      <span>{account.incomingCount} 条消息</span>
                      {account.lastReceivedAt && (
                        <time dateTime={account.lastReceivedAt}>
                          {new Date(account.lastReceivedAt).toLocaleDateString(
                            "zh-CN",
                            { month: "numeric", day: "numeric" },
                          )}
                        </time>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {admin.loadingAccounts && (
              <p className={styles.listNote} role="status">
                正在加载用户…
              </p>
            )}
            {!admin.loadingAccounts && admin.accounts.length === 0 && (
              <p className={styles.listNote}>
                {admin.accountsLoaded ? "暂无用户" : "用户列表暂不可用"}
              </p>
            )}
            {admin.accountsCursor !== null && (
              <button
                className={styles.moreAccounts}
                disabled={admin.busy === "logout" || admin.loadingAccounts}
                onClick={admin.moreAccounts}
              >
                更多用户
              </button>
            )}
          </aside>
          {admin.selected ? (
            <Inbox
              key={admin.selected.profile}
              account={admin.selected}
              admin={admin}
            />
          ) : (
            <section className={styles.selectionEmpty} aria-label="收件箱">
              <h2>选择一个用户</h2>
              <p>查看收到的消息</p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
