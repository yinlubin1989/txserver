import { FinanceError } from './financeError';
import { cents } from './money';
import type { Check, RecordEntry } from './ledger';

type WrittenTotal = { amount: string; source: string };
type IncomeReconciliation = {
  checks: Check[];
  incomeChecks: Set<Check>;
  ignoredItemIds: Set<string>;
  warnings: { message: string; severity: 'review' | 'info' }[];
};
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

function availableTotals(text: string) {
  const totals: WrittenTotal[] = [];
  let hasUnclearTotal = false;
  // Isolate explicitly labelled totals so one malformed amount does not discard
  // another independently verifiable subtotal from the same record.
  for (const section of text.normalize('NFKC').split(new RegExp(`(?=${TOTAL_LABEL})`, 'gu'))) {
    try { totals.push(...readIncomeTotals(section)); }
    catch (error) {
      if (!(error instanceof FinanceError)) throw error;
      hasUnclearTotal = true;
    }
  }
  return { totals, hasUnclearTotal };
}

export function incomeChecks(record: RecordEntry): IncomeReconciliation {
  const { totals, hasUnclearTotal } = availableTotals(record.source);
  const result: IncomeReconciliation = {
    checks: [...record.checks], incomeChecks: new Set(), ignoredItemIds: new Set(), warnings: [],
  };
  if (hasUnclearTotal) {
    result.warnings.push({ severity: 'review', message: '部分收入合计的金额格式不明确，当前按已识别明细统计；这些合计暂未参与核对，请核对。' });
    result.checks = result.checks.filter(check => !availableTotals(check.source).hasUnclearTotal);
  }
  if (!totals.length) return result;
  const income = record.items.filter(item => item.category === 'income');
  if (!income.length) {
    result.warnings.push({ severity: 'review', message: '原文写有收入合计，但未识别到对应收入项目，当前仅统计已识别账目；该笔收入暂未计入，请核对。' });
    result.checks = result.checks.filter(check => !totals.some(total => corresponds(check, total)));
    return result;
  }
  const aggregateItems = income.filter(item => item.unitPrice === null && item.quantity === null && item.amount !== null &&
    availableTotals(item.source).totals.some(written => cents(written.amount) === cents(item.amount!) &&
      totals.some(total => cents(total.amount) === cents(written.amount))));
  const sales = income.filter(item => !aggregateItems.includes(item) &&
    (item.amount !== null || (item.unitPrice !== null && item.quantity !== null)));
  if (totals.length === 1 && !hasUnclearTotal) {
    const total = totals[0];
    const hasSales = sales.length > 0;
    const ignored = hasSales ? aggregateItems : aggregateItems.slice(1);
    for (const item of ignored) result.ignoredItemIds.add(item.id);
    if (ignored.length) result.warnings.push({ severity: 'info', message: hasSales
      ? '收入合计仅用于核对，未重复计入。'
      : '同一收入合计被重复识别，已只计入一次。' });
    // Always compare all income in this record, even if the model omitted a check
    // or linked the declared total to only some of the sales.
    const check: Check = { ...total, itemIds: income.filter(item => !result.ignoredItemIds.has(item.id)).map(item => item.id) };
    result.checks = [...result.checks.filter(entry => !corresponds(entry, total)), check];
    result.incomeChecks.add(check);
    return result;
  }
  // Keep each verified scope. Unknown scopes affect the review notes, not the
  // ability to calculate the independently identified income entries.
  let hasUnknownScope = false;
  let excludedUnscopedAggregate = false;
  const retainedAggregateSources = new Set<string>();
  const processedAggregateIds = new Set<string>();
  for (const total of totals) {
    const matching = result.checks.filter(check => corresponds(check, total));
    const hasScope = matching.length === 1 && matching[0].itemIds.length > 0 &&
      matching[0].itemIds.every(id => income.some(item => item.id === id));
    const aggregates = aggregateItems.filter(item => cents(item.amount!) === cents(total.amount) &&
      compact(item.source).includes(compact(total.source)));
    const scopedSales = hasScope ? sales.filter(item => matching[0].itemIds.includes(item.id)) : [];
    const aggregateOnlyScope = hasScope && matching[0].itemIds.every(id => aggregates.some(item => item.id === id));
    const omitAggregates = scopedSales.length > 0 || (sales.length > 0 && !aggregateOnlyScope);
    for (const item of aggregates) {
      if (processedAggregateIds.has(item.id)) continue;
      processedAggregateIds.add(item.id);
      const key = compact(item.source);
      if (omitAggregates || retainedAggregateSources.has(key)) result.ignoredItemIds.add(item.id);
      else retainedAggregateSources.add(key);
    }
    if (aggregates.length && omitAggregates && !scopedSales.length) excludedUnscopedAggregate = true;
    if (!hasScope) {
      hasUnknownScope = true;
      result.checks = result.checks.filter(check => !matching.includes(check));
      continue;
    }
    const original = matching[0];
    const ids = original.itemIds.filter(id => !result.ignoredItemIds.has(id));
    if (!ids.length) {
      result.checks = result.checks.filter(check => check !== original);
      hasUnknownScope = true;
      continue;
    }
    const check = ids.length === original.itemIds.length ? original : { ...original, itemIds: ids };
    result.checks = result.checks.map(entry => entry === original ? check : entry);
    result.incomeChecks.add(check);
  }
  if (result.ignoredItemIds.size) result.warnings.push({ severity: 'info', message: '收入合计仅用于核对，未重复计入。' });
  if (excludedUnscopedAggregate) result.warnings.push({ severity: 'review', message: '部分收入合计与销售明细的对应范围不明确，为避免重复，暂按已识别销售明细统计，未另行叠加这些合计；如有只记合计的额外收入，请核对补充。' });
  if (hasUnknownScope) result.warnings.push({ severity: 'review', message: '部分收入合计对应的明细范围不明确，暂未核对这些合计；当前按已识别收入明细统计，请核对。' });
  return result;
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
