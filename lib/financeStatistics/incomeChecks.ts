import { FinanceError } from './financeError';
import { cents } from './money';
import type { Check, RecordEntry } from './ledger';

type WrittenTotal = { amount: string; source: string };
const TOTAL_LABEL = '(?:收入\\s*(?:合计|总计|共计)|(?:合计|总计|总)\\s*收入)';

function invalid(message: string): never { throw new FinanceError('INVALID_EXTRACTION', message, 502); }
function compact(value: string) { return value.normalize('NFKC').replace(/\s+/gu, ''); }

// A supplementary check for explicit income-total labels, not a parser for arbitrary notes.
// Unlabelled subtotals still use the model's validated source/relationship extraction.
export function readIncomeTotals(text: string): WrittenTotal[] {
  const normalized = text.normalize('NFKC');
  const pattern = new RegExp(`${TOTAL_LABEL}\\s*[:：=＝]?\\s*(?:人民币\\s*)?[¥￥]?\\s*([+−-]?\\d+(?:,\\d+)*(?:\\.\\d+)?)(?!\\d|\\.\\d)(?!\\s*(?:月|日|束|个))\\s*(?:元)?`, 'gu');
  return [...normalized.matchAll(pattern)].map(match => {
    if (!/^[+−-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(match[1])) invalid('原文收入合计金额格式不明确，请核对后重试。');
    const amount = match[1].replace(/,/g, '').replace(/^\+/, '').replace(/^−/, '-');
    cents(amount);
    return { amount, source: match[0].trim() };
  });
}

function corresponds(check: Check, total: WrittenTotal) {
  return cents(check.amount) === cents(total.amount) && compact(check.source).includes(compact(total.source));
}

export function incomeChecks(record: RecordEntry): { checks: Check[]; incomeChecks: Set<Check> } {
  const totals = readIncomeTotals(record.source);
  if (!totals.length) return { checks: record.checks, incomeChecks: new Set() };
  const income = record.items.filter(item => item.category === 'income');
  if (!income.length) invalid('原文写有收入合计，但未识别到收入项目，请重试。');
  if (totals.length === 1) {
    const total = totals[0];
    const aggregateItems = income.filter(item => readIncomeTotals(item.source).some(written =>
      cents(written.amount) === cents(total.amount)) && item.unitPrice === null && item.quantity === null);
    const hasSales = income.some(item => !aggregateItems.includes(item) &&
      (item.amount !== null || (item.unitPrice !== null && item.quantity !== null)));
    if (aggregateItems.length > 1 || (aggregateItems.length && hasSales)) invalid('收入合计与销售明细被重复识别，请重试；合计不能再次入账。');
    // Always compare all income in this record, even if the model omitted a check
    // or linked the declared total to only some of the sales.
    const check: Check = { ...total, itemIds: income.map(item => item.id) };
    const others = record.checks.filter(entry => !corresponds(entry, total));
    return { checks: [...others, check], incomeChecks: new Set([check]) };
  }
  // Several separate totals in one source require explicit scopes. Do not guess
  // that each is the entire day's total or silently merge overlapping sections.
  const checks = new Set<Check>();
  for (const total of totals) {
    const matching = record.checks.filter(check => corresponds(check, total));
    if (matching.length !== 1 || matching[0].itemIds.some(id => !income.some(item => item.id === id))) {
      invalid('同一段有多个收入合计，无法明确各自对应的明细；请分段记账后重试。');
    }
    checks.add(matching[0]);
  }
  return { checks: record.checks, incomeChecks: checks };
}

export function verifyIncomeTotalCoverage(records: RecordEntry[], text: string) {
  const counts = new Map<string, number>();
  for (const record of records) for (const total of readIncomeTotals(record.source)) {
    const key = compact(total.source);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const total of readIncomeTotals(text)) {
    const key = compact(total.source);
    const count = counts.get(key) ?? 0;
    if (!count) invalid('原文中的收入合计未被完整识别，请重试；不能跳过合计核对。');
    counts.set(key, count - 1);
  }
}
