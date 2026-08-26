"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import styles from "./calc.module.css";

type UnitKind = "big" | "small" | "red";

interface UnitDef {
  kind: UnitKind;
  label: string;
  emoji: string;
  unit: number;
}

const UNITS: UnitDef[] = [
  { kind: "big", label: "大花", emoji: "🌹", unit: 368 },
  { kind: "small", label: "小花", emoji: "🌸", unit: 288 },
  { kind: "red", label: "发红包", emoji: "🧧", unit: -60 },
];

function money(n: number): string {
  const abs = Math.abs(n).toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
  });
  return (n < 0 ? "-¥" : "¥") + abs;
}

export default function CalcApp() {
  const [counts, setCounts] = useState<Record<UnitKind, number>>({
    big: 0,
    small: 0,
    red: 0,
  });
  const [input, setInput] = useState<string>("");

  const subtotals = {
    big: counts.big * UNITS[0].unit,
    small: counts.small * UNITS[1].unit,
    red: counts.red * UNITS[2].unit,
  };
  const total = subtotals.big + subtotals.small + subtotals.red;

  /* ---------- 输入处理 ---------- */

  const pressDigit = useCallback((d: string) => {
    setInput((prev) => {
      if (prev.length >= 6) return prev;
      if (prev === "0") return d;
      return prev + d;
    });
  }, []);

  const backspace = useCallback(() => {
    setInput((prev) => prev.slice(0, -1));
  }, []);

  const clearInput = useCallback(() => {
    setInput("");
  }, []);

  /* ---------- 累加 ---------- */

  const pressUnit = useCallback((kind: UnitKind) => {
    const qty = input === "" ? 1 : parseInt(input, 10);
    if (!Number.isFinite(qty) || qty <= 0) {
      setInput("");
      return;
    }
    setCounts((prev) => ({ ...prev, [kind]: prev[kind] + qty }));
    setInput("");
  }, [input]);

  const reset = useCallback(() => {
    setCounts({ big: 0, small: 0, red: 0 });
    setInput("");
  }, []);

  const resetIfConfirmed = useCallback(() => {
    if (total === 0) {
      reset();
      return;
    }
    if (window.confirm("确定清零所有数量吗？")) {
      reset();
    }
  }, [total, reset]);

  /* ---------- 渲染 ---------- */

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <span className={styles.brandEmoji}>💐</span>
            <div>
              <h1 className={styles.title}>卖花记账</h1>
              <p className={styles.subtitle}>月末合计账单</p>
            </div>
          </div>
          <Link href="/" className={styles.homeLink} aria-label="返回首页">
            ← 首页
          </Link>
        </header>

        {/* 显示屏 */}
        <div className={styles.display}>
          <span className={styles.displayLabel}>合计</span>
          <span
            className={styles.displayTotal}
            data-negative={total < 0 ? "true" : undefined}
          >
            {money(total)}
          </span>
          <div className={styles.displayInput}>
            {input === "" ? (
              <span className={styles.hint}>输入数量再点单位 · 不输入＝1</span>
            ) : (
              <span>
                数量 <b className={styles.inputNum}>{input}</b>
              </span>
            )}
          </div>
        </div>

        {/* 三个单位键 */}
        <div className={styles.units}>
          {UNITS.map((u) => (
            <button
              key={u.kind}
              className={`${styles.unitBtn} ${styles["unit-" + u.kind]}`}
              onClick={() => pressUnit(u.kind)}
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
          <button className={`${styles.key} ${styles.keyFn}`} onClick={backspace}>
            ⌫
          </button>
        </div>

        {/* 汇总 */}
        <div className={styles.summary}>
          <div className={styles.summaryRow}>
            <span>🌹 大花</span>
            <span className={styles.summaryCount}>×{counts.big}</span>
            <span className={styles.summaryAmount}>{money(subtotals.big)}</span>
          </div>
          <div className={styles.summaryRow}>
            <span>🌸 小花</span>
            <span className={styles.summaryCount}>×{counts.small}</span>
            <span className={styles.summaryAmount}>{money(subtotals.small)}</span>
          </div>
          <div className={styles.summaryRow}>
            <span>🧧 红包</span>
            <span className={styles.summaryCount}>×{counts.red}</span>
            <span className={styles.summaryAmount}>{money(subtotals.red)}</span>
          </div>
          <div className={styles.summaryTotal}>
            <span>合计</span>
            <span data-negative={total < 0 ? "true" : undefined}>{money(total)}</span>
          </div>
        </div>

        {/* 清零 */}
        <button className={styles.resetBtn} onClick={resetIfConfirmed}>
          清零
        </button>
        <p className={styles.footNote}>仅在本机实时合计，不保存任何数据。</p>
      </div>
    </main>
  );
}