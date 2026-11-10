import { useState } from "react";
import type { ArchiveAccount } from "../api";
import type { useArchiveAdmin } from "../useArchiveAdmin";
import common from "../style.module.css";
import styles from "./style.module.css";

type Props = {
  account: ArchiveAccount;
  admin: ReturnType<typeof useArchiveAdmin>;
};
const formatTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });

export function Inbox({ account, admin }: Props) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(account.displayName ?? "");
  return (
    <section className={styles.inbox} aria-label="收件箱">
      <header className={styles.heading}>
        <div>
          <p>收到的消息</p>
          <div className={styles.title}>
            <h2>{account.displayName ?? account.profile}</h2>
            <button
              className={common.textButton}
              disabled={admin.busy !== null}
              onClick={() => {
                setName(account.displayName ?? "");
                setEditingName(!editingName);
              }}
            >
              备注
            </button>
          </div>
        </div>
        <button
          className={common.secondary}
          disabled={admin.busy !== null || admin.loadingRecords}
          onClick={admin.retryRecords}
        >
          刷新消息
        </button>
      </header>
      {editingName && (
        <form
          className={styles.nameForm}
          onSubmit={async (event) => {
            event.preventDefault();
            if (await admin.saveName(account.profile, name))
              setEditingName(false);
          }}
        >
          <label>
            备注姓名
            <input
              autoFocus
              maxLength={80}
              value={name}
              placeholder="留空清除备注"
              disabled={admin.busy === "rename"}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button className={common.primary} disabled={admin.busy !== null}>
            {admin.busy === "rename" ? "保存中…" : "保存备注"}
          </button>
          <button
            type="button"
            className={common.secondary}
            disabled={admin.busy === "rename"}
            onClick={() => setEditingName(false)}
          >
            取消
          </button>
        </form>
      )}
      {account.displayName && (
        <details className={styles.accountDetails}>
          <summary>账号信息</summary>
          <p>{account.profile}</p>
        </details>
      )}
      <details className={styles.filtersDetails}>
        <summary>
          筛选{admin.filters.from || admin.filters.to ? " · 已设置时间" : ""}
        </summary>
        <form
          className={styles.filters}
          onSubmit={(event) => {
            event.preventDefault();
            admin.applyFilters();
          }}
        >
          <label>
            开始时间（本地）
            <input
              type="datetime-local"
              step="1"
              value={admin.filters.from}
              disabled={admin.busy !== null}
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
              disabled={admin.busy !== null}
              onChange={(event) =>
                admin.changeFilters({
                  ...admin.filters,
                  to: event.target.value,
                })
              }
            />
          </label>
          <button
            className={common.primary}
            disabled={admin.busy !== null || admin.loadingRecords}
          >
            应用筛选
          </button>
        </form>
      </details>
      <div
        className={styles.records}
        aria-label="收到的消息"
        aria-busy={admin.loadingRecords}
      >
        {admin.loadingRecords ? (
          <p className={styles.empty} role="status">
            正在加载消息…
          </p>
        ) : admin.records.length === 0 ? (
          <p className={styles.empty}>
            {admin.loaded
              ? "暂无收到的消息"
              : admin.error
                ? "消息暂不可用，请重试"
                : "应用筛选查看消息"}
          </p>
        ) : (
          admin.records.map((record) => (
            <article
              className={styles.record}
              key={`${record.ownerId}:${record.id}`}
            >
              <div className={styles.recordHeading}>
                <h3 title={record.peerId}>
                  {record.peerName || record.peerId}
                </h3>
                <time dateTime={record.occurredAt}>
                  {formatTime(record.occurredAt)}
                </time>
              </div>
              <p className={styles.message}>
                {record.text || "（无文本内容）"}
              </p>
            </article>
          ))
        )}
      </div>
      <nav className={styles.pagination} aria-label="消息分页">
        <button
          className={common.secondary}
          disabled={
            admin.busy !== null || admin.loadingRecords || admin.page === 1
          }
          onClick={admin.previous}
        >
          上一页
        </button>
        <span>第 {admin.page} 页</span>
        <button
          className={common.secondary}
          disabled={
            admin.busy !== null ||
            admin.loadingRecords ||
            admin.nextCursor === null
          }
          onClick={admin.next}
        >
          下一页
        </button>
      </nav>
    </section>
  );
}
