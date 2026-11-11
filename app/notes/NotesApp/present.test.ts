import assert from "node:assert/strict";
import test from "node:test";
import { mergeBills, presentBill, presentReport } from "./present";

const report = {
  schemaVersion: 1,
  status: "completed",
  period: { year: 2026, month: 10 },
  totals: { days: 1, incomeCents: 102400, expenseCents: 48000, profitCents: 54400 },
  warnings: [
    { code: "ITEM_MISMATCH", date: "10月1日", message: "请核对单价。", severity: "review" },
    { code: "BLANK_AS_ZERO", date: "", message: "留空按0元。", severity: "info" },
    { code: "DUPLICATE", date: "10月2日", message: "重复已去掉。", severity: "info" },
  ],
  breakdown: {
    incomeByPrice: [{ unitPriceCents: 36800, quantity: 2, quantityUnit: "束", amountCents: 73600 }],
    unclassifiedIncomeCents: 28800,
    expenses: [
      { category: "redPacket", amountCents: 16000 },
      { category: "purchase", amountCents: 32000 },
      { category: "commission", amountCents: 0 },
      { category: "supplies", amountCents: 0 },
      { category: "other", amountCents: 0 },
    ],
  },
  dailyRows: [{
    day: 1,
    incomeCents: 102400,
    expenseCents: 48000,
    profitCents: 54400,
    commissionCheck: { status: "matched", message: "红包与规则一致。" },
    details: [
      { label: "368花束", category: "income", amountCents: 73600, unitPriceCents: 36800, quantity: 2, quantityUnit: "束", source: "368元花束 2束，736元", included: false, accountingNote: null },
      { label: "红包", category: "redPacket", amountCents: 16000, unitPriceCents: null, quantity: null, quantityUnit: null, source: "红包160元", included: false, accountingNote: null },
      { label: "提成", category: "commission", amountCents: 8000, unitPriceCents: null, quantity: null, quantityUnit: null, source: "提成已含在红包", included: true, accountingNote: "已包含于当日红包" },
    ],
  }],
};

test("月结单沿用小程序的金额符号和核对备注", () => {
  const presented = presentReport(report);
  assert.equal(presented.title, "2026年10月");
  assert.equal(presented.dateRange, "10.01 — 10.01");
  assert.equal(presented.displayTotals.income, "+1,024.00");
  assert.equal(presented.displayTotals.expense, "−480.00");
  assert.equal(presented.displayTotals.profit, "544.00");
  assert.equal(presented.breakdown.income[0].description, "368 元／束 × 2 束");
  assert.equal(presented.breakdown.income[0].displayAmount, "+736.00");
  assert.equal(presented.breakdown.hasUnclassifiedIncome, true);
  assert.equal(presented.breakdown.expenses.map((item) => item.label).join(","), "红包,进货");
  assert.equal(presented.rows[0].details[0].salesDescription, "368 元／束 × 2 束");
  assert.equal(presented.rows[0].details[2].displayAmount, "80.00");
  assert.equal(presented.rows[0].details[2].accountingNote, "已包含于当日红包");
  assert.equal(presented.reviewWarnings[0].dateLabel, "10/01");
  assert.equal(presented.reviewWarnings[0].isPreviewVisible, true);
  assert.equal(presented.infoWarnings[0].dateLabel, "说明");
  assert.equal(presented.infoWarnings[1].isPreviewVisible, false);
  assert.equal(presented.hasIncludedExpenses, true);
});

test("账本卡片按上海时间显示，加载更多时去重", () => {
  const first = presentBill({
    id: "a".repeat(24),
    createdAt: "2026-10-01T16:05:00.000Z",
    visibility: "public",
    period: { year: null, month: 10 },
    totals: { days: 3, incomeCents: 100, expenseCents: 40, profitCents: -20 },
    reviewCount: 2,
  });
  assert.equal(first.title, "10 月账单");
  assert.equal(first.savedAt, "2026.10.02 00:05");
  assert.equal(first.income, "+1.00");
  assert.equal(first.expense, "−0.40");
  assert.equal(first.profit, "−0.20");
  assert.equal(first.visibilityLabel, "公开");
  const newer = { ...first, id: "b".repeat(24), createdAt: "2026-10-03T00:00:00.000Z" };
  const merged = mergeBills([first, newer], [{ ...first, profit: "1.00" }]);
  assert.deepEqual(merged.map((bill) => bill.id[0]), ["b", "a"]);
  assert.equal(merged[1].profit, "1.00");
});

test("缺少单价分组时拒绝展示", () => {
  const broken = structuredClone(report);
  broken.breakdown.incomeByPrice[0].quantity = null as unknown as number;
  assert.throws(() => presentReport(broken), /统计结果格式异常/);
});
