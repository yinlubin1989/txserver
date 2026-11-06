import { FinanceError } from './financeError';

export function safe(value: number): number {
  if (!Number.isSafeInteger(value)) throw new FinanceError('INVALID_EXTRACTION', '金额超出可安全计算范围。', 502);
  return value;
}
export function cents(value: string): number {
  if (typeof value !== 'string' || !/^-?\d{1,12}(\.\d{1,2})?$/.test(value)) throw new FinanceError('INVALID_EXTRACTION', '识别出的金额格式不合法。', 502);
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return safe(negative ? -result : result);
}
export function sum(values: number[]) { return values.reduce((total, value) => safe(total + value), 0); }
export function money(value: number) { return `${value < 0 ? '-' : ''}${Math.floor(Math.abs(value) / 100)}.${String(Math.abs(value) % 100).padStart(2, '0')}`; }
