"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackLink, StatusMessage } from "../components/ui/PageKit";
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
  const [saveStatus, setSaveStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

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
    setSaveStatus(null);
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
      setSaveStatus(null);
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
    setSaveStatus(null);
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
    if (!ready || isEmpty || !todayKey) return;

    const record: DailyRecord = {
      id: makeId(),
      date: todayKey,
      big: counts.big,
      small: counts.small,
      redBig: counts.redBig,
      redSmall: counts.redSmall,
      total,
    };
    const nextRecords = [record, ...records];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRecords));
    } catch {
      setSaveStatus({ kind: "error", message: "保存失败，浏览器存储暂不可用。当前数量已保留，请重试。" });
      return;
    }
    setRecords(nextRecords);
    playTone(1046, 0.12);
    setSaveStatus({ kind: "success", message: `已保存 ${formatDateShort(todayKey)}的记录 ${money(total)}，可继续记下一笔。` });

    setCounts(EMPTY_COUNTS);
    setInput("");
  }, [ready, isEmpty, todayKey, counts, total, records]);

  const deleteRecord = useCallback((id: string) => {
    setSaveStatus(null);
    setRecords((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const clearHistory = useCallback(() => {
    if (records.length === 0) return;
    if (window.confirm("确定清空所有已保存记录吗？此操作不可撤销。")) {
      setSaveStatus(null);
      setRecords([]);
    }
  }, [records.length]);

  /* ---------- 渲染 ---------- */

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BackLink />
        <div className={styles.heading}>
          <div>
            <h1>卖花记账</h1>
            <p>记下每一笔，收支一目了然。</p>
          </div>
          {todayKey && <time dateTime={todayKey}>{formatDateShort(todayKey)}</time>}
        </div>
      </header>
      <div className={styles.workspace}>
      <section className={styles.card} aria-label="记账计算器">
        {/* 显示屏 */}
        <div className={styles.display}>
          <span className={styles.displayLabel}>本笔合计</span>
          <span
            className={styles.displayTotal}
            data-negative={total < 0 ? "true" : undefined}
            data-long={money(total).length > 11 ? "true" : undefined}
            aria-live="polite"
            aria-atomic="true"
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
        <div className={styles.units} aria-describedby="unit-hint">
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
              aria-label={`${u.label}，单价 ${u.unit} 元，当前数量 ${counts[u.kind]}，点击添加，长按清空该项`}
            >
              <span className={styles.unitEmoji} aria-hidden="true">{u.emoji}</span>
              <span className={styles.unitLabel}>{u.label}</span>
              <span className={styles.unitPrice}>
                {u.unit > 0 ? "+" : ""}
                {u.unit} 元
              </span>
              <span className={styles.unitBadge}>×{counts[u.kind]}</span>
            </button>
          ))}
        </div>
        <p className={styles.unitHint} id="unit-hint">长按单位键，清空该项数量。</p>

        {/* 数字键盘 */}
        <div className={styles.keypad}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} className={styles.key} onClick={() => pressDigit(d)}>
              {d}
            </button>
          ))}
          <button className={`${styles.key} ${styles.keyFn}`} onClick={clearInput} aria-label="C，清除输入数量">
            <span>C</span><span className={styles.keyCaption}>清除输入</span>
          </button>
          <button className={styles.key} onClick={() => pressDigit("0")}>
            0
          </button>
          <button className={`${styles.key} ${styles.keyFn}`} onClick={backspace} aria-label="退格，删除最后一位数量">
            ⌫
          </button>
        </div>

        {/* 保存 / 清零 */}
        <div className={styles.actions}>
          <button className={styles.saveBtn} onClick={saveToday} disabled={!ready || isEmpty}>
            保存今天
          </button>
          <button className={styles.resetBtn} onClick={resetInput}>
            本笔清零
          </button>
        </div>
        {saveStatus && <StatusMessage kind={saveStatus.kind}>{saveStatus.message}</StatusMessage>}
        <p className={styles.footNote}>数据保存在本机浏览器，同一天可保存多笔。</p>
      </section>

        {/* 已保存记录 */}
        <section className={styles.history} aria-labelledby="history-title">
          <div className={styles.historyHead}>
            <h2 id="history-title">已保存记录</h2>
            <span className={styles.monthTotal}>
              本月合计{" "}
              <b data-negative={monthTotal < 0 ? "true" : undefined}>
                {money(monthTotal)}
              </b>
            </span>
          </div>

          {!ready ? <div className={styles.empty} role="status">正在读取本机记录…</div> : records.length === 0 ? (
            <div className={styles.empty}>
              还没有保存记录。
              <br />
              输入数量后，点击「保存今天」。
            </div>
          ) : (
            groups.map(([month, list]) => (
              <div key={month} className={styles.monthGroup}>
                <div className={styles.monthHead}>{formatMonth(month)}</div>
                <ul className={styles.recordList}>
                  {list.map((r) => (
                    <li key={r.id} className={styles.recordItem}>
                      <div className={styles.recordSummary}>
                        <time className={styles.recordDate} dateTime={r.date}>{formatDateShort(r.date)}</time>
                        <span
                        className={styles.recordAmount}
                        data-negative={r.total < 0 ? "true" : undefined}
                      >
                        {money(r.total)}
                        </span>
                      </div>
                      <span className={styles.recordDetail}>
                        <span>大花 {r.big}</span><span>小花 {r.small}</span><span>大红 {r.redBig}</span><span>小红 {r.redSmall}</span>
                      </span>
                      <button
                        className={styles.recordDel}
                        onClick={() => deleteRecord(r.id)}
                        aria-label={`删除 ${formatDateShort(r.date)} ${money(r.total)}的记录`}
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
        </section>
      </div>
    </main>
  );
}
