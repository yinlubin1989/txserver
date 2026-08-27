"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./calc.module.css";

type UnitKind = "big" | "small" | "redBig" | "redSmall";

interface UnitDef {
  kind: UnitKind;
  label: string;
  emoji: string;
  unit: number;
}

interface DailyRecord {
  id: string;
  date: string; // YYYY-MM-DD
  big: number;
  small: number;
  redBig: number;
  redSmall: number;
  total: number;
}

const UNITS: UnitDef[] = [
  { kind: "big", label: "大花", emoji: "🌹", unit: 368 },
  { kind: "small", label: "小花", emoji: "🌸", unit: 288 },
  { kind: "redBig", label: "大红", emoji: "🧧", unit: -60 },
  { kind: "redSmall", label: "小红", emoji: "🧧", unit: -40 },
];

const STORAGE_KEY = "txserver-calc-daily-v2";

/* ---------- 日期与数字格式化 ---------- */

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateShort(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${m}月${d}日`;
}

function formatMonth(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${y}年${m}月`;
}

function money(n: number): string {
  const abs = Math.abs(n).toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
  });
  return (n < 0 ? "-¥" : "¥") + abs;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/* ---------- 按键音效 ---------- */

let audioCtx: AudioContext | null = null;

function playTone(freq: number, duration = 0.07, volume = 0.12) {
  try {
    if (typeof window === "undefined") return;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") void audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch {
    /* ignore */
  }
}

const EMPTY_COUNTS: Record<UnitKind, number> = {
  big: 0,
  small: 0,
  redBig: 0,
  redSmall: 0,
};

export default function CalcApp() {
  const [ready, setReady] = useState(false);
  const [todayKey, setTodayKey] = useState("");
  const [records, setRecords] = useState<DailyRecord[]>([]);
  const [counts, setCounts] = useState<Record<UnitKind, number>>(EMPTY_COUNTS);
  const [input, setInput] = useState<string>("");

  // 首次加载：读本地记录（在回调中 setState，避免 effect 内同步 setState）
  useEffect(() => {
    const timer = setTimeout(() => {
      setTodayKey(toDateKey(new Date()));
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setRecords(parsed);
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {
      /* ignore */
    }
  }, [records, ready]);

  const total =
    counts.big * UNITS[0].unit +
    counts.small * UNITS[1].unit +
    counts.redBig * UNITS[2].unit +
    counts.redSmall * UNITS[3].unit;

  const isEmpty =
    counts.big === 0 &&
    counts.small === 0 &&
    counts.redBig === 0 &&
    counts.redSmall === 0;

  /* ---------- 历史记录分组 ---------- */

  const groups = useMemo(() => {
    const map = new Map<string, DailyRecord[]>();
    const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date));
    for (const r of sorted) {
      const month = r.date.slice(0, 7);
      const list = map.get(month);
      if (list) list.push(r);
      else map.set(month, [r]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [records]);

  const currentMonth = todayKey.slice(0, 7);
  const monthTotal = useMemo(() => {
    return records
      .filter((r) => r.date.startsWith(currentMonth))
      .reduce((sum, r) => sum + r.total, 0);
  }, [records, currentMonth]);

  /* ---------- 输入处理 ---------- */

  const pressDigit = useCallback((d: string) => {
    playTone(660, 0.06);
    setInput((prev) => {
      if (prev.length >= 6) return prev;
      if (prev === "0") return d;
      return prev + d;
    });
  }, []);

  const backspace = useCallback(() => {
    playTone(440, 0.06);
    setInput((prev) => prev.slice(0, -1));
  }, []);

  const clearInput = useCallback(() => {
    playTone(440, 0.06);
    setInput("");
  }, []);

  /* ---------- 累加 ---------- */

  const pressUnit = useCallback(
    (kind: UnitKind) => {
      const qty = input === "" ? 1 : parseInt(input, 10);
      if (!Number.isFinite(qty) || qty <= 0) {
        setInput("");
        return;
      }
      playTone(880, 0.08);
      setCounts((prev) => ({ ...prev, [kind]: prev[kind] + qty }));
      setInput("");
    },
    [input],
  );

  const resetInput = useCallback(() => {
    playTone(330, 0.1);
    setCounts(EMPTY_COUNTS);
    setInput("");
  }, []);

  /* ---------- 长按单位键清空对应数量 ---------- */

  const longPress = useRef<{ timer: number | null; fired: boolean }>({
    timer: null,
    fired: false,
  });

  const startLongPress = useCallback((kind: UnitKind) => {
    longPress.current.fired = false;
    if (longPress.current.timer != null) window.clearTimeout(longPress.current.timer);
    longPress.current.timer = window.setTimeout(() => {
      longPress.current.timer = null;
      longPress.current.fired = true;
      setCounts((prev) => ({ ...prev, [kind]: 0 }));
      playTone(196, 0.18, 0.16);
      if ("vibrate" in navigator) navigator.vibrate(60);
    }, 500);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPress.current.timer != null) {
      window.clearTimeout(longPress.current.timer);
      longPress.current.timer = null;
    }
  }, []);

  const onUnitClick = useCallback(
    (kind: UnitKind) => {
      if (longPress.current.fired) {
        longPress.current.fired = false;
        return;
      }
      pressUnit(kind);
    },
    [pressUnit],
  );

  /* ---------- 保存与删除 ---------- */

  const saveToday = useCallback(() => {
    if (isEmpty || !todayKey) return;
    playTone(1046, 0.12);

    const record: DailyRecord = {
      id: makeId(),
      date: todayKey,
      big: counts.big,
      small: counts.small,
      redBig: counts.redBig,
      redSmall: counts.redSmall,
      total,
    };
    setRecords((prev) => [record, ...prev]);

    setCounts(EMPTY_COUNTS);
    setInput("");
  }, [isEmpty, todayKey, counts, total]);

  const deleteRecord = useCallback((id: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const clearHistory = useCallback(() => {
    if (records.length === 0) return;
    if (window.confirm("确定清空所有已保存记录吗？此操作不可撤销。")) {
      setRecords([]);
    }
  }, [records.length]);

  /* ---------- 渲染 ---------- */

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        {/* 显示屏 */}
        <div className={styles.display}>
          <span className={styles.displayLabel}>当天合计</span>
          <span
            className={styles.displayTotal}
            data-negative={total < 0 ? "true" : undefined}
          >
            {money(total)}
          </span>
          <div className={styles.displayInput}>
            {input === "" ? (
              <span className={styles.hint}>先输数量，再点单位（不输＝1）</span>
            ) : (
              <span>
                数量 <b className={styles.inputNum}>{input}</b>
              </span>
            )}
          </div>
        </div>

        {/* 四个单位键 */}
        <div className={styles.units}>
          {UNITS.map((u) => (
            <button
              key={u.kind}
              className={`${styles.unitBtn} ${styles["unit-" + u.kind]}`}
              onClick={() => onUnitClick(u.kind)}
              onPointerDown={() => startLongPress(u.kind)}
              onPointerUp={cancelLongPress}
              onPointerLeave={cancelLongPress}
              onPointerCancel={cancelLongPress}
              onContextMenu={(e) => e.preventDefault()}
            >
              {counts[u.kind] > 0 && (
                <span className={styles.unitBadge}>×{counts[u.kind]}</span>
              )}
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

        {/* 保存 / 清零 */}
        <div className={styles.actions}>
          <button className={styles.saveBtn} onClick={saveToday} disabled={isEmpty}>
            💾 保存今天
          </button>
          <button className={styles.resetBtn} onClick={resetInput}>
            清零
          </button>
        </div>

        {/* 已保存记录 */}
        <div className={styles.history}>
          <div className={styles.historyHead}>
            <span>已保存记录</span>
            <span className={styles.monthTotal}>
              本月合计{" "}
              <b data-negative={monthTotal < 0 ? "true" : undefined}>
                {money(monthTotal)}
              </b>
            </span>
          </div>

          {records.length === 0 ? (
            <div className={styles.empty}>
              还没有保存记录。
              <br />
              输入当天数量后，点上面的「保存今天」。
            </div>
          ) : (
            groups.map(([month, list]) => (
              <div key={month} className={styles.monthGroup}>
                <div className={styles.monthHead}>{formatMonth(month)}</div>
                <ul className={styles.recordList}>
                  {list.map((r) => (
                    <li key={r.id} className={styles.recordItem}>
                      <span className={styles.recordDate}>{formatDateShort(r.date)}</span>
                      <span className={styles.recordDetail}>
                        大花{r.big} · 小花{r.small} · 大红{r.redBig} · 小红{r.redSmall}
                      </span>
                      <span
                        className={styles.recordAmount}
                        data-negative={r.total < 0 ? "true" : undefined}
                      >
                        {money(r.total)}
                      </span>
                      <button
                        className={styles.recordDel}
                        onClick={() => deleteRecord(r.id)}
                        aria-label="删除这条"
                        title="删除"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}

          {records.length > 0 && (
            <button className={styles.clearBtn} onClick={clearHistory}>
              清空所有记录
            </button>
          )}
        </div>

        <p className={styles.footNote}>
          数据保存在本机浏览器 · 长按单位键可清空该项
        </p>
      </div>
    </main>
  );
}