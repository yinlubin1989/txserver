"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./calc.module.css";

type UnitKind = "big" | "small" | "red";
type Kind = UnitKind | "custom";

interface UnitDef {
  kind: UnitKind;
  label: string;
  emoji: string;
  unit: number;
}

interface Entry {
  id: string;
  ts: number;
  date: string;
  kind: Kind;
  label: string;
  qty: number;
  unit: number;
  amount: number;
}

const UNITS: UnitDef[] = [
  { kind: "big", label: "大花", emoji: "🌹", unit: 368 },
  { kind: "small", label: "小花", emoji: "🌸", unit: 288 },
  { kind: "red", label: "发红包", emoji: "🧧", unit: -60 },
];

const STORAGE_KEY = "txserver-calc-v1";

/* ---------- 日期与数字格式化 ---------- */

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function shiftDate(key: string, delta: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + delta);
  return toDateKey(d);
}

function formatDateKey(key: string): string {
  return parseDateKey(key).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function money(n: number): string {
  const abs = Math.abs(n).toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
  });
  return (n < 0 ? "-¥" : "¥") + abs;
}

function moneySigned(n: number): string {
  const abs = Math.abs(n).toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
  });
  return (n < 0 ? "-" : "+") + "¥" + abs;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ---------- 组件 ---------- */

export default function CalcApp() {
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [dateKey, setDateKey] = useState<string>("");
  const [input, setInput] = useState<string>("");
  const [sign, setSign] = useState<1 | -1>(1);
  const [flash, setFlash] = useState<string>("");

  // 首次加载：读本地记录（在回调中 setState，避免 effect 内同步 setState）
  useEffect(() => {
    const timer = setTimeout(() => {
      const today = toDateKey(new Date());
      setDateKey(today);
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setEntries(parsed);
        }
      } catch {
        /* ignore */
      }
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // 记录变化即保存
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      /* ignore */
    }
  }, [entries, ready]);

  // 提示自动消失
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(""), 2200);
    return () => clearTimeout(t);
  }, [flash]);

  const dayEntries = useMemo(() => {
    return entries
      .filter((e) => e.date === dateKey)
      .sort((a, b) => b.ts - a.ts);
  }, [entries, dateKey]);

  const summary = useMemo(() => {
    const s: Record<Kind, { count: number; amount: number }> = {
      big: { count: 0, amount: 0 },
      small: { count: 0, amount: 0 },
      red: { count: 0, amount: 0 },
      custom: { count: 0, amount: 0 },
    };
    for (const e of dayEntries) {
      s[e.kind].count += e.qty;
      s[e.kind].amount += e.amount;
    }
    return s;
  }, [dayEntries]);

  const total = dayEntries.reduce((sum, e) => sum + e.amount, 0);

  /* ---------- 输入处理 ---------- */

  const pressDigit = useCallback((d: string) => {
    setInput((prev) => {
      if (prev.length >= 8) return prev;
      if (prev === "0") return d;
      return prev + d;
    });
  }, []);

  const pressDot = useCallback(() => {
    setInput((prev) => {
      if (prev.includes(".")) return prev;
      if (prev === "" || prev === "-") return prev + "0.";
      return prev + ".";
    });
  }, []);

  const backspace = useCallback(() => {
    setInput((prev) => prev.slice(0, -1));
  }, []);

  const clearInput = useCallback(() => {
    setInput("");
  }, []);

  /* ---------- 记账 ---------- */

  const addEntry = useCallback(
    (kind: Kind, label: string, qty: number, unit: number) => {
      const amount = round2(qty * unit);
      const entry: Entry = {
        id: makeId(),
        ts: Date.now(),
        date: dateKey,
        kind,
        label,
        qty,
        unit,
        amount,
      };
      setEntries((prev) => [entry, ...prev]);
      setFlash(`${label} × ${qty} = ${moneySigned(amount)} 已加入`);
    },
    [dateKey],
  );

  const pressUnit = useCallback(
    (u: UnitDef) => {
      const qty = input === "" ? 1 : parseFloat(input);
      if (!Number.isFinite(qty) || qty <= 0) {
        setInput("");
        return;
      }
      addEntry(u.kind, `${u.emoji} ${u.label}`, qty, u.unit);
      setInput("");
    },
    [input, addEntry],
  );

  const pressCustom = useCallback(() => {
    const v = input === "" ? NaN : parseFloat(input);
    if (!Number.isFinite(v) || v <= 0) {
      setInput("");
      return;
    }
    const amount = round2(sign * v);
    addEntry("custom", sign === 1 ? "其他收入" : "其他支出", 1, amount);
    setInput("");
  }, [input, sign, addEntry]);

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const resetDay = useCallback(() => {
    if (dayEntries.length === 0) return;
    if (window.confirm(`确定清空 ${formatDateKey(dateKey)} 的全部记录吗？此操作不可撤销。`)) {
      setEntries((prev) => prev.filter((e) => e.date !== dateKey));
      setFlash("已清空当天记录");
    }
  }, [dayEntries.length, dateKey]);

  const goToday = useCallback(() => setDateKey(toDateKey(new Date())), []);
  const goPrev = useCallback(() => setDateKey((k) => shiftDate(k, -1)), []);
  const goNext = useCallback(() => setDateKey((k) => shiftDate(k, 1)), []);

  /* ---------- 渲染 ---------- */

  const inputQty = input === "" ? "" : input;

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        {/* 头部 */}
        <header className={styles.header}>
          <div className={styles.brand}>
            <span className={styles.brandEmoji}>💐</span>
            <div>
              <h1 className={styles.title}>卖花记账</h1>
              <p className={styles.subtitle}>每天一笔一笔记清楚</p>
            </div>
          </div>
          <Link href="/" className={styles.homeLink} aria-label="返回首页">
            ← 首页
          </Link>
        </header>

        {/* 日期切换 */}
        <div className={styles.dateBar}>
          <button className={styles.dateNav} onClick={goPrev} aria-label="前一天">
            ‹
          </button>
          <div className={styles.dateBox}>
            <span className={styles.dateText}>
              {dateKey ? formatDateKey(dateKey) : "…"}
            </span>
            {dateKey && dateKey === toDateKey(new Date()) && (
              <span className={styles.todayTag}>今天</span>
            )}
          </div>
          <button className={styles.dateNav} onClick={goNext} aria-label="后一天">
            ›
          </button>
          <button className={styles.todayBtn} onClick={goToday}>
            回今天
          </button>
        </div>

        {/* 显示屏 */}
        <div className={styles.display}>
          <span className={styles.displayLabel}>当日合计</span>
          <span
            className={styles.displayTotal}
            data-negative={total < 0 ? "true" : undefined}
          >
            {money(total)}
          </span>
          <div className={styles.displayInput}>
            {inputQty === "" ? (
              <span className={styles.hint}>输入数量，再点上面单位</span>
            ) : (
              <span>
                数量 <b className={styles.inputNum}>{inputQty}</b>
              </span>
            )}
          </div>
        </div>

        {flash && <div className={styles.flash}>{flash}</div>}

        {/* 三个单位键 */}
        <div className={styles.units}>
          {UNITS.map((u) => (
            <button
              key={u.kind}
              className={`${styles.unitBtn} ${styles["unit-" + u.kind]}`}
              onClick={() => pressUnit(u)}
            >
              <span className={styles.unitEmoji}>{u.emoji}</span>
              <span className={styles.unitLabel}>{u.label}</span>
              <span className={styles.unitPrice}>
                {u.unit > 0 ? "+" : ""}
                {u.unit} 元
              </span>
            </button>
          ))}
        </div>

        {/* 数字键盘 */}
        <div className={styles.keypad}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} className={styles.key} onClick={() => pressDigit(d)}>
              {d}
            </button>
          ))}
          <button className={`${styles.key} ${styles.keyFn}`} onClick={clearInput}>
            C
          </button>
          <button className={styles.key} onClick={() => pressDigit("0")}>
            0
          </button>
          <button className={styles.key} onClick={pressDot}>
            .
          </button>
          <button className={`${styles.key} ${styles.keyFn}`} onClick={backspace}>
            ⌫
          </button>
        </div>

        {/* 自定义金额 */}
        <div className={styles.custom}>
          <div className={styles.signToggle} role="group" aria-label="收支方向">
            <button
              className={sign === 1 ? styles.signActive : undefined}
              onClick={() => setSign(1)}
            >
              ＋ 收入
            </button>
            <button
              className={sign === -1 ? styles.signActive : undefined}
              onClick={() => setSign(-1)}
            >
              － 支出
            </button>
          </div>
          <button className={styles.customBtn} onClick={pressCustom}>
            {sign === 1 ? "加入金额" : "减去金额"}
            {inputQty !== "" && (
              <span className={styles.customPreview}>
                {money(sign * (parseFloat(inputQty) || 0))}
              </span>
            )}
          </button>
        </div>

        {/* 汇总 */}
        <div className={styles.summary}>
          <div className={styles.summaryRow}>
            <span>🌹 大花</span>
            <span className={styles.summaryCount}>×{summary.big.count}</span>
            <span className={styles.summaryAmount}>{money(summary.big.amount)}</span>
          </div>
          <div className={styles.summaryRow}>
            <span>🌸 小花</span>
            <span className={styles.summaryCount}>×{summary.small.count}</span>
            <span className={styles.summaryAmount}>{money(summary.small.amount)}</span>
          </div>
          <div className={styles.summaryRow}>
            <span>🧧 红包</span>
            <span className={styles.summaryCount}>×{summary.red.count}</span>
            <span className={styles.summaryAmount}>{money(summary.red.amount)}</span>
          </div>
          {summary.custom.count > 0 && (
            <div className={styles.summaryRow}>
              <span>✏️ 其他</span>
              <span className={styles.summaryCount}>{summary.custom.count}笔</span>
              <span className={styles.summaryAmount}>{money(summary.custom.amount)}</span>
            </div>
          )}
        </div>

        {/* 明细 */}
        <div className={styles.ledger}>
          <div className={styles.ledgerHead}>
            <span>明细</span>
            <span>{dayEntries.length} 笔</span>
          </div>
          {dayEntries.length === 0 ? (
            <div className={styles.empty}>今天还没有记录，点上面的按键开始记账。</div>
          ) : (
            <ul className={styles.ledgerList}>
              {dayEntries.map((e) => (
                <li key={e.id} className={styles.ledgerItem}>
                  <span className={styles.ledgerTime}>{formatTime(e.ts)}</span>
                  <span className={styles.ledgerLabel}>{e.label}</span>
                  <span className={styles.ledgerQty}>
                    {e.kind === "custom" ? "" : `×${e.qty}`}
                  </span>
                  <span
                    className={styles.ledgerAmount}
                    data-negative={e.amount < 0 ? "true" : undefined}
                  >
                    {moneySigned(e.amount)}
                  </span>
                  <button
                    className={styles.ledgerDel}
                    onClick={() => removeEntry(e.id)}
                    aria-label="删除这条"
                    title="删除"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 底部操作 */}
        <div className={styles.footer}>
          <button className={styles.resetBtn} onClick={resetDay}>
            清空当天记录
          </button>
          <p className={styles.footNote}>数据保存在本机浏览器，不联网、不丢失。</p>
        </div>
      </div>
    </main>
  );
}