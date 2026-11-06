import { invalid, LedgerError } from './errors';
import type { BillCursor, FinanceReport, SaveInput } from './types';

const EXPENSES = ['redPacket', 'purchase', 'commission', 'supplies', 'other'];
const CATEGORIES = ['income', ...EXPENSES];
const CHECK_STATUSES = ['matched', 'mismatch', 'incomplete', 'inferred'];
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
export const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
export const ID_PATTERN = /^[a-f0-9]{24}$/;

function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
}
function string(value: unknown, max = 20000, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) invalid();
}
function integer(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid('账单金额或数量必须是安全整数。');
}
function precise(value: bigint): number {
  if (value > MAX_SAFE || value < -MAX_SAFE) invalid('账单金额或数量超出安全范围。');
  return Number(value);
}
function sum(values: number[]) { return precise(values.reduce((total, value) => total + BigInt(value), BigInt(0))); }
function amounts(value: Record<string, unknown>) {
  integer(value.incomeCents); integer(value.expenseCents); integer(value.profitCents);
  if (precise(BigInt(value.incomeCents) - BigInt(value.expenseCents)) !== value.profitCents) invalid('账单利润与收支不一致。');
}
function quantity(value: Record<string, unknown>) {
  if (value.unitPriceCents !== null) integer(value.unitPriceCents);
  if (value.quantity !== null) { integer(value.quantity); if (value.quantity < 0) invalid(); }
  if (value.quantityUnit !== null) string(value.quantityUnit, 12);
}

export function validateReport(input: unknown): FinanceReport {
  exact(input, ['schemaVersion', 'status', 'period', 'dailyRows', 'totals', 'breakdown', 'warnings']);
  if (input.schemaVersion !== 1 || input.status !== 'completed') invalid('只能保存统计成功的账单。');
  exact(input.period, ['year', 'month']);
  integer(input.period.month);
  if (input.period.month < 1 || input.period.month > 12) invalid();
  if (input.period.year !== null) { integer(input.period.year); if (input.period.year < 1900 || input.period.year > 2200) invalid(); }
  if (!Array.isArray(input.dailyRows) || !input.dailyRows.length || input.dailyRows.length > 31) invalid();
  const lastDay = new Date(Date.UTC(Number(input.period.year ?? 2000), input.period.month, 0)).getUTCDate();
  const effective: FinanceReport['dailyRows'][number]['details'] = [];
  let previousDay = 0;
  for (const row of input.dailyRows) {
    exact(row, ['day', 'incomeCents', 'expenseCents', 'profitCents', 'details', 'commissionCheck']);
    integer(row.day); amounts(row);
    if (row.day <= previousDay || row.day > lastDay) invalid('账单日期必须合法、有序且不重复。');
    previousDay = row.day;
    if (!Array.isArray(row.details) || !row.details.length || row.details.length > 10000) invalid();
    if (row.commissionCheck !== null) {
      exact(row.commissionCheck, ['status', 'message']);
      if (typeof row.commissionCheck.status !== 'string' || !CHECK_STATUSES.includes(row.commissionCheck.status)) invalid();
      string(row.commissionCheck.message);
    }
    for (const detail of row.details) {
      exact(detail, ['label', 'category', 'amountCents', 'unitPriceCents', 'quantity', 'quantityUnit', 'source', 'included', 'accountingNote']);
      string(detail.label, 200); string(detail.source); integer(detail.amountCents); quantity(detail);
      if (typeof detail.category !== 'string' || !CATEGORIES.includes(detail.category) || typeof detail.included !== 'boolean' || (detail.category === 'income' && detail.included)) invalid();
      if (detail.accountingNote !== null) string(detail.accountingNote);
      if (detail.unitPriceCents !== null && detail.quantity !== null && precise(BigInt(detail.unitPriceCents as number) * BigInt(detail.quantity as number)) !== detail.amountCents) invalid('单价、数量与明细金额不一致。');
    }
    const details = row.details as FinanceReport['dailyRows'][number]['details'];
    const counted = details.filter(detail => !detail.included);
    if (sum(counted.filter(detail => detail.category === 'income').map(detail => detail.amountCents)) !== row.incomeCents || sum(counted.filter(detail => detail.category !== 'income').map(detail => detail.amountCents)) !== row.expenseCents) invalid('每日收支与有效明细不一致。');
    effective.push(...counted);
  }
  exact(input.totals, ['days', 'incomeCents', 'expenseCents', 'profitCents']);
  amounts(input.totals);
  const rows = input.dailyRows as FinanceReport['dailyRows'];
  if (input.totals.days !== rows.length || input.totals.incomeCents !== sum(rows.map(row => row.incomeCents)) || input.totals.expenseCents !== sum(rows.map(row => row.expenseCents))) invalid('月度合计与每日明细不一致。');

  exact(input.breakdown, ['incomeByPrice', 'unclassifiedIncomeCents', 'expenses']);
  const breakdown = input.breakdown;
  integer(breakdown.unclassifiedIncomeCents);
  if (!Array.isArray(breakdown.incomeByPrice) || !Array.isArray(breakdown.expenses) || breakdown.expenses.length !== EXPENSES.length) invalid();
  const groups = new Map<string, { unitPriceCents: number; quantity: number; quantityUnit: string | null; amountCents: number }>();
  let unclassified = 0;
  for (const detail of effective.filter(detail => detail.category === 'income')) {
    if (detail.unitPriceCents === null || detail.quantity === null) { unclassified = sum([unclassified, detail.amountCents]); continue; }
    const key = JSON.stringify([detail.unitPriceCents, detail.quantityUnit]);
    const group = groups.get(key) ?? { unitPriceCents: detail.unitPriceCents, quantity: 0, quantityUnit: detail.quantityUnit, amountCents: 0 };
    group.quantity = sum([group.quantity, detail.quantity]); group.amountCents = sum([group.amountCents, detail.amountCents]);
    groups.set(key, group);
  }
  const expectedGroups = [...groups.values()].sort((a, b) => b.quantity - a.quantity || b.amountCents - a.amountCents || a.unitPriceCents - b.unitPriceCents || (a.quantityUnit ?? '').localeCompare(b.quantityUnit ?? '', 'zh-CN'));
  if (breakdown.incomeByPrice.length !== expectedGroups.length || breakdown.unclassifiedIncomeCents !== unclassified) invalid('收入分类与明细不一致。');
  breakdown.incomeByPrice.forEach((group, index) => {
    exact(group, ['unitPriceCents', 'quantity', 'quantityUnit', 'amountCents']); quantity(group); integer(group.amountCents);
    const expected = expectedGroups[index];
    if (group.unitPriceCents !== expected.unitPriceCents || group.quantity !== expected.quantity || group.quantityUnit !== expected.quantityUnit || group.amountCents !== expected.amountCents) invalid('收入分类与明细不一致。');
  });
  breakdown.expenses.forEach((group, index) => {
    exact(group, ['category', 'amountCents']); integer(group.amountCents);
    if (group.category !== EXPENSES[index] || group.amountCents !== sum(effective.filter(detail => detail.category === group.category).map(detail => detail.amountCents))) invalid('支出分类与明细不一致。');
  });
  if (!Array.isArray(input.warnings) || input.warnings.length > 10000) invalid();
  for (const warning of input.warnings) {
    exact(warning, ['code', 'date', 'message', 'severity']); string(warning.code, 64); string(warning.date, 100, true); string(warning.message);
    if (warning.severity !== 'info' && warning.severity !== 'review') invalid();
  }
  return input as FinanceReport;
}

export function validateSave(input: unknown): SaveInput {
  exact(input, ['report', 'text', 'clientRequestId']);
  string(input.text, 20000); string(input.clientRequestId, 100);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(input.clientRequestId)) invalid('保存请求标识不合法。');
  return { report: validateReport(input.report), text: input.text, clientRequestId: input.clientRequestId };
}
export function validateId(id: string) { if (!ID_PATTERN.test(id)) throw new LedgerError('BILL_NOT_FOUND', '这张账单不存在或无法访问。', 404); }
export function decodeCursor(value: string | null): BillCursor | null {
  if (value === null) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error();
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    exact(decoded, ['createdAt', 'id']);
    if (typeof decoded.createdAt !== 'string' || new Date(decoded.createdAt).toISOString() !== decoded.createdAt || typeof decoded.id !== 'string' || !ID_PATTERN.test(decoded.id)) throw new Error();
    return decoded as BillCursor;
  } catch { throw new LedgerError('INVALID_CURSOR', '账本分页参数不正确，请刷新后重试。'); }
}
export function encodeCursor(bill: BillCursor) { return Buffer.from(JSON.stringify({ createdAt: bill.createdAt, id: bill.id })).toString('base64url'); }
