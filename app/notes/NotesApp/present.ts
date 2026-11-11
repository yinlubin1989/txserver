const CATEGORIES = {
  income: "收入",
  commission: "提成",
  redPacket: "红包",
  purchase: "进货",
  supplies: "耗材",
  other: "其他",
} as const;

const COMMISSION_CHECK_STATUSES = ["matched", "mismatch", "incomplete", "inferred"] as const;
const WARNING_TITLES: Record<string, string> = {
  DUPLICATE: "重复记录已去重",
  ITEM_MISMATCH: "单价、数量与金额不一致",
  TOTAL_MISMATCH: "合计已按明细重算",
  INCOME_TOTAL_MISMATCH: "收入合计与明细不一致",
  INCLUDED: "已包含费用未重复入账",
  BLANK_AS_ZERO: "留空金额按 0 元处理",
  COMMISSION_MISMATCH: "红包与默认提成有差异",
  COMMISSION_INCOMPLETE: "提成信息无法完整核对",
  COMMISSION_INFERRED: "未填写的红包已按规则补算",
};

export type PresentedWarning = {
  key: string;
  code: string;
  date: string;
  message: string;
  dateLabel: string;
  compactDate: boolean;
  displayMessage: string;
  title: string;
  severity: "review" | "info";
  isPreviewVisible: boolean;
};

export type PresentedDetail = {
  key: string;
  label: string;
  categoryLabel: string;
  amount: string;
  included: boolean;
  source: string;
  accountingNote: string | null;
  displayAmount: string;
  isIncome: boolean;
  salesDescription: string;
};

export type PresentedRow = {
  day: number;
  income: string;
  expense: string;
  profit: string;
  expanded: boolean;
  isLoss: boolean;
  incomeDisplay: string;
  expenseDisplay: string;
  profitDisplay: string;
  commissionCheck: { status: string; message: string } | null;
  details: PresentedDetail[];
};

export type PresentedReport = {
  status: "completed";
  title: string;
  month: number;
  year: number | null;
  dateRange: string;
  rows: PresentedRow[];
  totals: { income: string; expense: string; profit: string };
  days: number;
  reviewWarnings: PresentedWarning[];
  infoWarnings: PresentedWarning[];
  displayTotals: { income: string; expense: string; profit: string };
  warningCount: number;
  warningsExpanded: boolean;
  profitSize: "small" | "medium" | "regular";
  compactAmounts: boolean;
  dailyViewportHeight: number;
  hasIncludedExpenses: boolean;
  breakdown: {
    income: { key: string; description: string; displayAmount: string }[];
    expenses: { key: string; label: string; displayAmount: string }[];
    unclassifiedIncomeDisplay: string;
    hasUnclassifiedIncome: boolean;
  };
  incomeExpanded: boolean;
  expenseExpanded: boolean;
};

export type BillSummary = {
  id: string;
  createdAt: string;
  visibility: "private" | "public";
  period: { year: number | null; month: number };
  totals: { days: number; incomeCents: number; expenseCents: number; profitCents: number };
  reviewCount: number;
};

export type PresentedBill = {
  id: string;
  createdAt: string;
  title: string;
  periodLabel: string;
  income: string;
  expense: string;
  profit: string;
  savedAt: string;
  reviewCount: number;
  visibility: "private" | "public";
  visibilityLabel: string;
};

function invalid(): never {
  throw new Error("统计结果格式异常，请重试。");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function amount(value: number) {
  if (!Number.isSafeInteger(value)) invalid();
  const absolute = Math.abs(value);
  const whole = String(Math.floor(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${value < 0 ? "-" : ""}${whole}.${String(absolute % 100).padStart(2, "0")}`;
}

function amounts(row: { incomeCents: number; expenseCents: number; profitCents: number }) {
  return { income: amount(row.incomeCents), expense: amount(row.expenseCents), profit: amount(row.profitCents) };
}

function signedAmount(value: number, isIncome: boolean) {
  const formatted = amount(value);
  const sign = (value < 0) === isIncome ? "−" : "+";
  return sign + formatted.replace(/^-/, "");
}

function readQuantity(item: Record<string, unknown>) {
  const unitPriceCents = item.unitPriceCents;
  const quantity = item.quantity;
  const quantityUnit = item.quantityUnit;
  if (unitPriceCents !== null && !Number.isSafeInteger(unitPriceCents)) invalid();
  if (quantity !== null && (!Number.isSafeInteger(quantity) || (quantity as number) < 0)) invalid();
  if (quantityUnit !== null && (typeof quantityUnit !== "string" || !quantityUnit.trim())) invalid();
  return {
    unitPriceCents: unitPriceCents as number | null,
    quantity: quantity as number | null,
    quantityUnit: quantityUnit as string | null,
  };
}

function salesDescription(item: Record<string, unknown>) {
  const { unitPriceCents, quantity, quantityUnit } = readQuantity(item);
  const price = unitPriceCents === null ? null : amount(unitPriceCents).replace(/\.00$/, "");
  const quantityLabel = quantity === null ? null : `${quantity}${quantityUnit === null ? "（单位未注明）" : ` ${quantityUnit}`}`;
  if (price !== null && quantityLabel !== null) return `${price} 元${quantityUnit === null ? "" : `／${quantityUnit}`} × ${quantityLabel}`;
  if (price !== null) return `单价 ${price} 元 · 数量未注明`;
  if (quantityLabel !== null) return `数量 ${quantityLabel} · 单价未注明`;
  return "";
}

function presentBreakdown(breakdown: unknown) {
  if (!isRecord(breakdown) || !Array.isArray(breakdown.incomeByPrice) || !Array.isArray(breakdown.expenses)) invalid();
  const income = breakdown.incomeByPrice.map((item, index) => {
    if (!isRecord(item)) invalid();
    const { unitPriceCents, quantity } = readQuantity(item);
    if (unitPriceCents === null || quantity === null || !Number.isSafeInteger(item.amountCents)) invalid();
    return {
      key: `price-${index}`,
      description: salesDescription(item),
      displayAmount: signedAmount(item.amountCents as number, true),
    };
  });
  const expenses = breakdown.expenses.flatMap((item) => {
    if (!isRecord(item) || typeof item.category !== "string" || !(item.category in CATEGORIES) || item.category === "income") invalid();
    if (!Number.isSafeInteger(item.amountCents)) invalid();
    if (item.amountCents === 0) return [];
    return [{
      key: item.category,
      label: CATEGORIES[item.category as keyof typeof CATEGORIES],
      displayAmount: signedAmount(item.amountCents as number, false),
    }];
  });
  if (!Number.isSafeInteger(breakdown.unclassifiedIncomeCents)) invalid();
  return {
    income,
    expenses,
    unclassifiedIncomeDisplay: signedAmount(breakdown.unclassifiedIncomeCents as number, true),
    hasUnclassifiedIncome: breakdown.unclassifiedIncomeCents !== 0,
  };
}

function presentCommissionCheck(check: unknown) {
  if (check === null) return null;
  if (!isRecord(check) || typeof check.status !== "string" || typeof check.message !== "string" || !check.message.trim() ||
      !COMMISSION_CHECK_STATUSES.includes(check.status as typeof COMMISSION_CHECK_STATUSES[number])) invalid();
  return { status: check.status, message: check.message };
}

function warningDate(date: string) {
  const match = /^(\d{1,2})月(\d{1,2})日$/.exec(date);
  if (match && Number(match[1]) >= 1 && Number(match[1]) <= 12 && Number(match[2]) >= 1 && Number(match[2]) <= 31) {
    return { dateLabel: `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")}`, compactDate: true };
  }
  return { dateLabel: date || "说明", compactDate: !date };
}

function displayWarningMessage(message: string) {
  return message.replace(/➕\uFE0F?/gu, "+").replace(/🟰\uFE0F?/gu, "=");
}

function presentWarnings(warnings: unknown[]) {
  const reviewWarnings: PresentedWarning[] = [];
  const infoWarnings: PresentedWarning[] = [];
  warnings.forEach((item, index) => {
    if (!isRecord(item) || typeof item.code !== "string" || !item.code.trim() || typeof item.date !== "string" ||
        typeof item.message !== "string" || !item.message.trim() || (item.severity !== "review" && item.severity !== "info")) invalid();
    const warning: PresentedWarning = {
      key: `warning-${index}`,
      code: item.code,
      date: item.date,
      message: item.message,
      ...warningDate(item.date),
      displayMessage: displayWarningMessage(item.message),
      title: Object.prototype.hasOwnProperty.call(WARNING_TITLES, item.code)
        ? WARNING_TITLES[item.code]
        : item.severity === "review" ? "请优先核对账目" : "账目处理说明",
      severity: item.severity,
      isPreviewVisible: false,
    };
    if (item.severity === "review") reviewWarnings.push(warning);
    else infoWarnings.push(warning);
  });
  [...reviewWarnings, ...infoWarnings].forEach((warning, index) => {
    warning.isPreviewVisible = index < 2;
  });
  return { reviewWarnings, infoWarnings };
}

export function presentReport(payload: unknown): PresentedReport {
  if (!isRecord(payload) || payload.schemaVersion !== 1 || payload.status !== "completed" || !isRecord(payload.period) ||
      !Number.isInteger(payload.period.month) || (payload.period.month as number) < 1 || (payload.period.month as number) > 12 ||
      (payload.period.year !== null && (!Number.isInteger(payload.period.year) || (payload.period.year as number) < 1900 || (payload.period.year as number) > 2200)) ||
      !Array.isArray(payload.dailyRows) || !payload.dailyRows.length || !Array.isArray(payload.warnings) || !isRecord(payload.totals)) invalid();
  const totalsRecord = payload.totals;
  if (!Number.isInteger(totalsRecord.days) || !Number.isSafeInteger(totalsRecord.incomeCents) ||
      !Number.isSafeInteger(totalsRecord.expenseCents) || !Number.isSafeInteger(totalsRecord.profitCents)) invalid();
  const rows = payload.dailyRows.map((row) => {
    if (!isRecord(row) || !Number.isInteger(row.day) || (row.day as number) < 1 || (row.day as number) > 31 || !Array.isArray(row.details) ||
        !Number.isSafeInteger(row.incomeCents) || !Number.isSafeInteger(row.expenseCents) || !Number.isSafeInteger(row.profitCents)) invalid();
    return {
      day: row.day as number,
      ...amounts({ incomeCents: row.incomeCents as number, expenseCents: row.expenseCents as number, profitCents: row.profitCents as number }),
      expanded: false,
      isLoss: (row.profitCents as number) < 0,
      incomeDisplay: signedAmount(row.incomeCents as number, true),
      expenseDisplay: signedAmount(row.expenseCents as number, false),
      profitDisplay: amount(row.profitCents as number).replace(/^-/, "−"),
      commissionCheck: presentCommissionCheck(row.commissionCheck),
      details: row.details.map((item, index) => {
        if (!isRecord(item) || typeof item.category !== "string" || !(item.category in CATEGORIES) || typeof item.label !== "string" ||
            typeof item.source !== "string" || typeof item.included !== "boolean" ||
            (item.accountingNote !== null && (typeof item.accountingNote !== "string" || !item.accountingNote.trim())) ||
            !Number.isSafeInteger(item.amountCents)) invalid();
        readQuantity(item);
        return {
          key: `${row.day}-${index}`,
          label: item.label,
          categoryLabel: CATEGORIES[item.category as keyof typeof CATEGORIES],
          amount: amount(item.amountCents as number),
          included: item.included,
          source: item.source,
          accountingNote: item.accountingNote as string | null,
          displayAmount: item.included ? amount(item.amountCents as number) : signedAmount(item.amountCents as number, item.category === "income"),
          isIncome: item.category === "income",
          salesDescription: item.category === "income" ? salesDescription(item) : "",
        };
      }),
    };
  });
  const totals = amounts({
    incomeCents: totalsRecord.incomeCents as number,
    expenseCents: totalsRecord.expenseCents as number,
    profitCents: totalsRecord.profitCents as number,
  });
  const month = String(payload.period.month).padStart(2, "0");
  const firstDay = Math.min(...rows.map((row) => row.day));
  const lastDay = Math.max(...rows.map((row) => row.day));
  const year = payload.period.year as number | null;
  const monthNumber = payload.period.month as number;
  return {
    status: "completed",
    title: `${year === null ? "" : `${year}年`}${monthNumber}月`,
    month: monthNumber,
    year,
    dateRange: `${month}.${String(firstDay).padStart(2, "0")} — ${month}.${String(lastDay).padStart(2, "0")}`,
    rows,
    totals,
    days: totalsRecord.days as number,
    ...presentWarnings(payload.warnings),
    displayTotals: {
      income: signedAmount(totalsRecord.incomeCents as number, true),
      expense: signedAmount(totalsRecord.expenseCents as number, false),
      profit: totals.profit.replace(/^-/, "−"),
    },
    warningCount: payload.warnings.length,
    warningsExpanded: false,
    profitSize: totals.profit.length > 17 ? "small" : totals.profit.length > 12 ? "medium" : "regular",
    compactAmounts: Math.max(totals.income.length, totals.expense.length) > 13,
    dailyViewportHeight: Math.min(rows.length, 5) * 73,
    hasIncludedExpenses: rows.some((row) => row.details.some((detail) => detail.included && !detail.isIncome)),
    breakdown: presentBreakdown(payload.breakdown),
    incomeExpanded: false,
    expenseExpanded: false,
  };
}

function money(cents: number) {
  if (!Number.isSafeInteger(cents)) throw new Error("账单金额格式异常，请重试。");
  const absolute = Math.abs(cents);
  const whole = String(Math.floor(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${cents < 0 ? "−" : ""}${whole}.${String(absolute % 100).padStart(2, "0")}`;
}

function flowMoney(cents: number, isIncome: boolean) {
  const isNegative = isIncome ? cents < 0 : cents >= 0;
  return `${isNegative ? "−" : "+"}${money(Math.abs(cents))}`;
}

function savedTime(value: string) {
  const date = new Date(Date.parse(value) + 8 * 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) throw new Error("账单保存时间格式异常，请重试。");
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export function presentBill(bill: BillSummary): PresentedBill {
  return {
    id: bill.id,
    createdAt: bill.createdAt,
    title: `${bill.period.year === null ? "" : `${bill.period.year} 年 `}${bill.period.month} 月账单`,
    periodLabel: `${bill.period.year === null ? "" : `${bill.period.year} 年 · `}已统计 ${bill.totals.days} 天`,
    income: flowMoney(bill.totals.incomeCents, true),
    expense: flowMoney(bill.totals.expenseCents, false),
    profit: money(bill.totals.profitCents),
    savedAt: savedTime(bill.createdAt),
    reviewCount: bill.reviewCount,
    visibility: bill.visibility,
    visibilityLabel: bill.visibility === "public" ? "公开" : "私有",
  };
}

export function mergeBills(current: PresentedBill[], incoming: PresentedBill[]) {
  const byId = new Map(current.map((bill) => [bill.id, bill]));
  incoming.forEach((bill) => byId.set(bill.id, bill));
  return [...byId.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
}
