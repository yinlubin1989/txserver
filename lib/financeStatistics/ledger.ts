import { FinanceError } from './financeError';
import { cents, safe, sum, money, multiply } from './money';
import { incomeChecks, verifyIncomeTotalCoverage } from './incomeChecks';
import { applyCommissionPolicy, type CalculatedEntry, type CommissionCheck } from './commissionPolicy';
export { FinanceError } from './financeError';
export { cents } from './money';
export type Category = 'income' | 'commission' | 'redPacket' | 'purchase' | 'supplies' | 'other';
export type Item = { id: string; category: Category; label: string; amount: string | null; unitPrice: string | null; quantity: number | null; quantityUnit: string | null; source: string; includedIn: string | null; inclusionSource: string | null; commissionFor: string | null };
export type Check = { amount: string; itemIds: string[]; source: string };
export type RecordEntry = { year: number | null; month: number; day: number; source: string; items: Item[]; checks: Check[] };
type Warning = { code: string; date: string; message: string; severity: 'review' | 'info' };
export type Detail = { label: string; category: Category; amountCents: number; unitPriceCents: number | null; quantity: number | null; quantityUnit: string | null; source: string; included: boolean; accountingNote: string | null };
type DailyRow = { day: number; incomeCents: number; expenseCents: number; profitCents: number; details: Detail[]; commissionCheck: CommissionCheck | null };
type IncomePriceGroup = { unitPriceCents: number; quantity: number; quantityUnit: string | null; amountCents: number };
const EXPENSE_CATEGORIES = ['redPacket', 'purchase', 'commission', 'supplies', 'other'] as const;
const categories = ['income', 'commission', 'redPacket', 'purchase', 'supplies', 'other'];
const nullableString = { type: ['string', 'null'] };
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const extractionSchema = object({ records: { type: 'array', items: object({
  year: { type: ['integer', 'null'] }, month: { type: 'integer' }, day: { type: 'integer' }, source: { type: 'string' },
  items: { type: 'array', items: object({ id: { type: 'string' }, category: { type: 'string', enum: categories }, label: { type: 'string' }, amount: nullableString, unitPrice: nullableString, quantity: { type: ['integer', 'null'] }, quantityUnit: nullableString, source: { type: 'string' }, includedIn: nullableString, inclusionSource: nullableString, commissionFor: nullableString }) },
  checks: { type: 'array', items: object({ amount: { type: 'string' }, itemIds: { type: 'array', items: { type: 'string' } }, source: { type: 'string' } }) },
}) } });
function invalid(message = '账目识别结构不完整，请调整原文后重试。'): never { throw new FinanceError('INVALID_EXTRACTION', message, 502); }
function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!isObject(value) || Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) invalid();
}
// Ignore layout whitespace without merging separate numeric tokens (e.g. 368 11).
function sourceTokens(text: string) { return `|${(text.match(/\d+(?:\.\d+)?|[^\s]/gu) ?? []).join('|')}|`; }
function source(value: unknown, text: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || !sourceTokens(text).includes(sourceTokens(value))) invalid('识别内容无法与原文对应，请重试。');
}
function numericTokens(evidence: string) {
  return evidence.normalize('NFKC').replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '').match(/-?\d+(?:\.\d+)?/g) ?? [];
}
function verifyAmount(value: string, evidence: string) {
  const tokens = numericTokens(evidence);
  if (!tokens.some(token => /^-?\d{1,12}(\.\d{1,2})?$/.test(token) && cents(token) === cents(value))) invalid('识别金额缺少对应的原文数字，请重试。');
}
function verifyQuantity(quantity: unknown, unit: unknown, evidence: string) {
  if (unit !== null && (typeof unit !== 'string' || !/^[\p{L}]{1,12}$/u.test(unit) || !evidence.includes(unit))) invalid('数量单位缺少对应的原文依据。');
  if (quantity === null) return;
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 0) invalid('识别出的数量格式不合法。');
  const normalized = evidence.normalize('NFKC');
  const tokens = normalized.match(/-?\d+(?:\.\d+)?/g) ?? [];
  if (!tokens.some(token => Number(token) === quantity)) invalid('数量缺少对应的原文数字。');
  if (unit !== null) {
    // Match the number attached to the stated unit, not a price elsewhere in the line.
    const pattern = new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*${unit}(?![A-Za-z])`, 'gu');
    if (![...normalized.matchAll(pattern)].some(match => Number(match[1]) === quantity)) invalid('数量与原文计量单位不对应。');
  }
}
function verifyMissingAmount(item: Item) {
  if (item.amount !== null) return;
  // Preserve genuinely empty price rows from older extractions, without inferring a price or quantity.
  if (item.quantity === null && item.quantityUnit !== null &&
      new RegExp(`^\\s*\\d{1,12}(?:\\.\\d{1,2})?\\s+${item.quantityUnit}\\s*(?:元)?\\s*[，,。.;；]?\\s*$`, 'u').test(item.source.normalize('NFKC'))) return;
  const remaining = numericTokens(item.source);
  const consume = (matches: (token: string) => boolean) => {
    const index = remaining.findIndex(matches);
    if (index < 0) invalid('金额留白的单价或数量依据不明确，请重试。');
    remaining.splice(index, 1);
  };
  if (item.unitPrice !== null) consume(token => /^-?\d{1,12}(\.\d{1,2})?$/.test(token) && cents(token) === cents(item.unitPrice!));
  if (item.quantity !== null) consume(token => Number(token) === item.quantity);
  if (remaining.length) invalid('原文含有未识别的金额，不能按留白计为0，请重试。');
}
function verifyInclusion(evidence: string, recordSource: string) {
  const snippet = evidence.normalize('NFKC').replace(/\s+/g, '');
  if (!/含|包括|已计入|在内/.test(snippet)) invalid('包含关系缺少原文依据。');
  const original = recordSource.normalize('NFKC').replace(/\s+/g, '');
  const denied = /(?:不|未|没|无|非)[^，,。；;]{0,8}(?:含|包括|计入)|(?:另(?:外|行)?|单独|额外)(?:计|付|算|支付|收)|不在[^，,。；;]{0,8}内/;
  const uncertain = /是否|可能|或许|不确定|疑似|待确认|待核实|不清楚|不明确|[?？]/;
  for (let index = original.indexOf(snippet); index !== -1; index = original.indexOf(snippet, index + 1)) {
    // Include adjacent original text so extracting “包含” from “不包含” cannot bypass the check.
    const context = original.slice(Math.max(0, index - 12), index + snippet.length + 12);
    if (denied.test(context) || uncertain.test(context)) invalid('原文包含关系是否定或不明确，不能排除费用，请调整原文后重试。');
  }
}
function verifyCommissionReferences(items: Item[]) {
  for (const item of items) {
    if (item.category !== 'commission') continue;
    const sale = item.commissionFor === null ? null : items.find(candidate => candidate.id === item.commissionFor);
    if (item.commissionFor !== null && (!sale || sale.category !== 'income' || !sourceTokens(item.source).includes(sourceTokens(sale.source)))) invalid('提成关联销售缺少完整原文依据。');
    if (item.unitPrice !== null) {
      if (!sale || sale.quantity === null || sale.quantityUnit !== '束' || item.quantity !== sale.quantity || item.quantityUnit !== '束') invalid('每束提成必须关联数量明确的花束销售。');
      const normalized = item.source.normalize('NFKC');
      const perUnit = [...normalized.matchAll(/(?:每\s*束\s*(?:提成)?\s*[:：]?\s*(-?\d+(?:\.\d+)?)|提成\s*[:：]?\s*(-?\d+(?:\.\d+)?)\s*元?\s*[\/／]\s*束)/gu)];
      if (!perUnit.some(match => cents(match[1] ?? match[2]) === cents(item.unitPrice!))) invalid('每束提成单价缺少原文明示，不能把总提成乘销量。');
      if (item.amount === null) verifyMissingAmount({ ...item, quantity: null, source: sourceTokens(item.source).replace(sourceTokens(sale.source), '') });
    } else if (item.quantity !== null || item.quantityUnit !== null) invalid('总提成不应带有推算数量或单位。');
  }
}
function validate(raw: unknown, text: string): RecordEntry[] {
  exact(raw, ['records']);
  if (!Array.isArray(raw.records) || !raw.records.length) throw new FinanceError('NO_RECORDS', '未识别到有日期的账目，请补充日期和记账内容。');
  if (raw.records.length > 200) invalid();
  for (const record of raw.records) {
    exact(record, ['year', 'month', 'day', 'source', 'items', 'checks']); source(record.source, text);
    const { year, month, day } = record;
    if (year !== null && (!Number.isInteger(year) || Number(year) < 1900 || Number(year) > 2200)) invalid();
    if (!Number.isInteger(month) || !Number.isInteger(day) || Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > new Date(Date.UTC(Number(year ?? 2000), Number(month), 0)).getUTCDate()) throw new FinanceError('INVALID_DATE', '日期不明确或不合法，请补充日期后重试。');
    if (!Array.isArray(record.items) || !record.items.length || record.items.length > 300 || !Array.isArray(record.checks)) invalid();
    const ids = new Set<string>();
    for (const item of record.items) {
      exact(item, ['id', 'category', 'label', 'amount', 'unitPrice', 'quantity', 'quantityUnit', 'source', 'includedIn', 'inclusionSource', 'commissionFor']);
      if (typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.label !== 'string' || !item.label.trim() || !categories.includes(String(item.category))) invalid();
      ids.add(item.id); source(item.source, record.source);
      for (const key of ['amount', 'unitPrice']) if (item[key] !== null) { cents(item[key] as string); verifyAmount(item[key] as string, item.source); }
      verifyQuantity(item.quantity, item.quantityUnit, item.source);
      if (!(item.category === 'commission' && item.unitPrice !== null)) verifyMissingAmount(item as Item);
      if (item.commissionFor !== null && (item.category !== 'commission' || typeof item.commissionFor !== 'string')) invalid('提成关联销售字段不合法。');
      if (item.includedIn !== null && (typeof item.includedIn !== 'string' || item.includedIn === item.id)) invalid();
      if (item.includedIn !== null) { source(item.inclusionSource, record.source); verifyInclusion(item.inclusionSource, record.source); }
      else if (item.inclusionSource !== null) invalid();
    }
    for (const item of record.items) if (item.includedIn !== null) {
      const parent = record.items.find((candidate: Item) => candidate.id === item.includedIn);
      if (!parent || parent.includedIn !== null || parent.category === 'income' || item.category === 'income' || parent.amount === null) invalid('费用包含关系不合法。');
    }
    verifyCommissionReferences(record.items as Item[]);
    const items = record.items;
    for (const check of record.checks) {
      exact(check, ['amount', 'itemIds', 'source']); cents(check.amount as string); source(check.source, record.source); verifyAmount(check.amount as string, check.source);
      if (!Array.isArray(check.itemIds) || !check.itemIds.length || new Set(check.itemIds).size !== check.itemIds.length || check.itemIds.some(id => !ids.has(id))) invalid();
      const kinds = new Set(check.itemIds.map(id => items.find((item: Item) => item.id === id).category === 'income'));
      if (kinds.size !== 1) invalid();
    }
  }
  return raw.records as RecordEntry[];
}
function buildBreakdown(rows: DailyRow[], incomeCents: number, expenseCents: number) {
  const priceGroups = new Map<string, IncomePriceGroup>();
  const expenses = EXPENSE_CATEGORIES.map(category => ({ category, amountCents: 0 }));
  let unclassifiedIncomeCents = 0;
  for (const row of rows) {
    for (const detail of row.details) {
      if (detail.included) continue;
      if (detail.category !== 'income') {
        const expense = expenses.find(entry => entry.category === detail.category)!;
        expense.amountCents = sum([expense.amountCents, detail.amountCents]);
      } else if (detail.unitPriceCents !== null && detail.quantity !== null) {
        const key = JSON.stringify([detail.unitPriceCents, detail.quantityUnit]);
        const group = priceGroups.get(key) ?? { unitPriceCents: detail.unitPriceCents, quantityUnit: detail.quantityUnit, quantity: 0, amountCents: 0 };
        group.quantity = safe(group.quantity + detail.quantity);
        group.amountCents = sum([group.amountCents, detail.amountCents]);
        priceGroups.set(key, group);
      } else {
        unclassifiedIncomeCents = sum([unclassifiedIncomeCents, detail.amountCents]);
      }
    }
  }
  const incomeByPrice = [...priceGroups.values()].sort((a, b) =>
    b.quantity - a.quantity || b.amountCents - a.amountCents || a.unitPriceCents - b.unitPriceCents ||
    (a.quantityUnit ?? '').localeCompare(b.quantityUnit ?? '', 'zh-CN'));
  if (sum([unclassifiedIncomeCents, ...incomeByPrice.map(group => group.amountCents)]) !== incomeCents || sum(expenses.map(expense => expense.amountCents)) !== expenseCents) invalid('分类统计与总额不一致，请重试。');
  return { incomeByPrice, unclassifiedIncomeCents, expenses };
}
export function calculateLedger(raw: unknown, text: string) {
  const records = validate(raw, text);
  verifyIncomeTotalCoverage(records, text);
  const months = new Set(records.map(record => record.month));
  const years = new Set(records.map(record => record.year).filter(year => year !== null));
  if (months.size !== 1 || years.size > 1) throw new FinanceError('MULTIPLE_MONTHS', '请每次粘贴一个月的账目。');
  const warnings: Warning[] = [];
  const seen = new Set<string>();
  const days = new Map<number, { record: RecordEntry; recordIndex: number }[]>();
  const blankDates = new Set<string>();
  for (const [recordIndex, record] of records.entries()) {
    const date = `${record.month}月${record.day}日`;
    if (seen.has(record.source)) { warnings.push({ code: 'DUPLICATE', date, severity: 'info', message: `${date}完全重复的记录已只计一次。` }); continue; }
    seen.add(record.source);
    days.set(record.day, [...(days.get(record.day) ?? []), { record, recordIndex }]);
  }
  const dailyRows: DailyRow[] = [];
  for (const [day, dayRecords] of days) {
    const date = `${records[0].month}月${day}日`;
    const entries: CalculatedEntry[] = [];
    for (const { record, recordIndex } of dayRecords) {
      for (const item of record.items) {
        let amount = item.amount === null ? 0 : cents(item.amount);
        if (item.unitPrice !== null && item.quantity !== null) {
          const computed = multiply(cents(item.unitPrice), item.quantity);
          amount = computed;
        } else if (item.amount === null && item.category !== 'redPacket' && item.category !== 'commission') blankDates.add(date);
        const detail: Detail = {
          label: item.label, category: item.category, amountCents: amount,
          unitPriceCents: item.unitPrice === null ? null : cents(item.unitPrice), quantity: item.quantity, quantityUnit: item.quantityUnit,
          source: item.source, included: item.includedIn !== null,
          accountingNote: item.includedIn !== null ? '原文明示已包含于其他支出，未重复计入'
            : item.category === 'commission' && item.unitPrice !== null && item.quantity !== null
              ? `原文明示每束提成，按${item.quantity}束×${money(cents(item.unitPrice))}元＝${money(amount)}元计算` : null,
        };
        entries.push({ recordIndex, item, detail });
      }
    }
    const policy = applyCommissionPolicy(date, entries, dayRecords.map(entry => entry.record.source));
    // Classify only after inclusion rules: a discrepancy in an excluded fee cannot change the total.
    for (const { item, detail } of policy.entries) {
      if (item.amount === null || item.unitPrice === null || item.quantity === null || detail.amountCents === cents(item.amount)) continue;
      warnings.push({
        code: 'ITEM_MISMATCH', date, severity: detail.included ? 'info' : 'review',
        message: `${date}${item.label}的单价×数量为${money(detail.amountCents)}元，原文行金额为${money(cents(item.amount))}元。${detail.included
          ? '该项已包含于其他支出，未重复计入，不影响当前合计。'
          : '两者不一致，无法确定哪项记错；当前按单价×数量计入，请核对单价、数量和金额后修改原文重新统计。'}`,
      });
    }
    for (const { record, recordIndex } of dayRecords) {
      const amounts = new Map(policy.entries.filter(entry => entry.recordIndex === recordIndex).map(entry => [entry.item.id, entry.detail.included ? 0 : entry.detail.amountCents]));
      const reconciled = incomeChecks(record);
      for (const check of reconciled.checks) {
        const computed = sum(check.itemIds.map(id => amounts.get(id)!));
        const stated = cents(check.amount);
        if (computed === stated) continue;
        if (reconciled.incomeChecks.has(check)) {
          const difference = sum([computed, -stated]);
          warnings.push({ code: 'INCOME_TOTAL_MISMATCH', date, severity: 'review', message: `${date}原文收入合计${money(stated)}元，按全部收入明细重算为${money(computed)}元，比原文${difference > 0 ? '多' : '少'}${money(Math.abs(difference))}元。当前按明细计入，无法确定是明细还是合计记错，请核对后修改原文重新统计。` });
        } else warnings.push({ code: 'TOTAL_MISMATCH', date, severity: 'info', message: `${date}「${check.source}」按明细计为${money(computed)}元，与原文合计相差${money(safe(computed - stated))}元。` });
      }
    }
    const details = [...policy.entries.map(entry => entry.detail), ...policy.generated];
    for (const entry of policy.entries) if (entry.item.includedIn !== null && entry.item.category !== 'commission') warnings.push({ code: 'INCLUDED', date, severity: 'info', message: `${date}${entry.item.label}原文明示已包含，未重复计入。` });
    const effective = details.filter(detail => !detail.included);
    const incomeCents = sum(effective.filter(detail => detail.category === 'income').map(detail => detail.amountCents));
    const expenseCents = sum(effective.filter(detail => detail.category !== 'income').map(detail => detail.amountCents));
    dailyRows.push({ day, incomeCents, expenseCents, profitCents: safe(incomeCents - expenseCents), details, commissionCheck: policy.commissionCheck });
  }
  if (blankDates.size) warnings.push({ code: 'BLANK_AS_ZERO', date: '', severity: 'info', message: `${[...blankDates].join('、')}未填写金额的项目按0元处理。` });
  for (const [status, code, description] of [
    ['mismatch', 'COMMISSION_MISMATCH', '天红包与规则核对金额有差异，已按原文红包入账'],
    ['incomplete', 'COMMISSION_INCOMPLETE', '天提成信息不完整，已按原文红包入账'],
    ['inferred', 'COMMISSION_INFERRED', '天未填写红包，已按默认规则和注明提成补算'],
  ] as const) {
    const count = dailyRows.filter(row => row.commissionCheck?.status === status).length;
    if (count) warnings.push({ code, date: '', severity: 'info', message: `${count}${description}；请展开对应日期明细查看。` });
  }
  dailyRows.sort((a, b) => a.day - b.day);
  const incomeCents = sum(dailyRows.map(row => row.incomeCents));
  const expenseCents = sum(dailyRows.map(row => row.expenseCents));
  const breakdown = buildBreakdown(dailyRows, incomeCents, expenseCents);
  return { schemaVersion: 1, status: 'completed' as const, period: { year: [...years][0] ?? null, month: records[0].month }, dailyRows, totals: { days: dailyRows.length, incomeCents, expenseCents, profitCents: safe(incomeCents - expenseCents) }, breakdown, warnings };
}
