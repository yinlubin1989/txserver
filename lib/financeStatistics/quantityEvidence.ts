export type QuantityEvidence = {
  value: number;
  raw: string;
  index: number;
  end: number;
  notation: 'arabic' | 'chinese';
};

const DIGITS = '零一二三四五六七八九';
const SMALL_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
const ALIASES: Record<string, string> = {
  〇: '零', 两: '二', 兩: '二', 壹: '一', 贰: '二', 貳: '二', 叁: '三', 參: '三',
  肆: '四', 伍: '五', 陆: '六', 陸: '六', 柒: '七', 捌: '八', 玖: '九',
  拾: '十', 佰: '百', 仟: '千', 萬: '万',
};
const CHINESE_CHARACTERS = '零〇一二两兩三四五六七八九十百千万亿億壹贰貳叁參肆伍陆陸柒捌玖拾佰仟萬';
const CHINESE_BOUNDARY = new RegExp(`[${CHINESE_CHARACTERS}]`, 'u');
const CHINESE_PLACE_UNIT = /^[十百千万拾佰仟萬]/u;
// Keep vague/fractional expressions in one candidate so “两三” or “三点五”
// cannot contribute a definite suffix quantity such as 三 or 五.
const CHINESE_CANDIDATE = `[${CHINESE_CHARACTERS}几幾多余餘来來半点點分之负負]+`;
const CANDIDATES = new RegExp(`[+−-]?(?:\\d[\\d,.]*|\\.\\d+)(?:[eE][+−-]?\\d+)?|${CHINESE_CANDIDATE}`, 'gu');

function formatSection(value: number) {
  let result = '', pendingZero = false;
  for (const [unit, name] of [[1000, '千'], [100, '百'], [10, '十'], [1, '']] as const) {
    const digit = Math.floor(value / unit) % 10;
    if (digit) {
      if (pendingZero) result += '零';
      result += DIGITS[digit] + name;
      pendingZero = false;
    } else if (result && value % unit) pendingZero = true;
  }
  return result;
}

function formatChinese(value: number) {
  if (!value) return '零';
  const high = Math.floor(value / 10000), low = value % 10000;
  const result = high ? `${formatSection(high)}万${low ? `${low < 1000 ? '零' : ''}${formatSection(low)}` : ''}` : formatSection(low);
  return result.replace(/^一十/u, '十');
}

function parseChinese(raw: string): number | null {
  let input = [...raw].map(character => ALIASES[character] ?? character).join('');
  if (!/^[零一二三四五六七八九十百千万]+$/u.test(input)) return null;
  if (/^[百千万]/u.test(input)) input = `一${input}`;
  let total = 0, section = 0, digit = 0;
  for (const character of input) {
    const number = DIGITS.indexOf(character);
    if (number >= 0) digit = number;
    else if (character === '万') {
      total += (section + digit) * 10000;
      section = 0; digit = 0;
    } else {
      section += (digit || 1) * SMALL_UNITS[character];
      digit = 0;
    }
  }
  const value = total + section + digit;
  if (!Number.isSafeInteger(value) || value > 99999999) return null;
  const comparable = (text: string) => text.replace(/^一十/u, '十').replace(/零一十/gu, '零十');
  // Round-trip prevents ambiguous shorthand (“一百二”) and malformed adjacent
  // digits (“两三”) from being silently interpreted as precise integers.
  return comparable(input) === comparable(formatChinese(value)) ? value : null;
}

function normalizeWithOffsets(text: string) {
  let normalized = '';
  const starts: number[] = [], ends: number[] = [];
  let offset = 0;
  for (const character of text) {
    const part = character.normalize('NFKC');
    normalized += part;
    for (let index = 0; index < part.length; index++) {
      starts.push(offset); ends.push(offset + character.length);
    }
    offset += character.length;
  }
  return { normalized, starts, ends };
}

/** Read precise quantity evidence without rewriting source text or monetary tokens. */
export function readQuantityEvidence(text: string, unit: string | null): QuantityEvidence[] {
  const { normalized, starts, ends } = normalizeWithOffsets(text);
  const results: QuantityEvidence[] = [];
  const unitPattern = unit === null ? null : new RegExp(`^\\s*${unit.normalize('NFKC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'u');
  for (const match of normalized.matchAll(CANDIDATES)) {
    const raw = match[0], start = match.index, end = start + raw.length;
    const notation = /^[+−.\d-]/u.test(raw) ? 'arabic' : 'chinese';
    const previous = normalized[start - 1] ?? '';
    const next = normalized[end] ?? '';
    if (notation === 'arabic' && (CHINESE_BOUNDARY.test(previous) || CHINESE_PLACE_UNIT.test(next))) continue;
    if (notation === 'chinese' && (
      (CHINESE_PLACE_UNIT.test(raw) && /\d/u.test(previous))
      || /[−-]/u.test(previous)
      || /\d/u.test(next)
    )) continue;
    const value = notation === 'chinese' ? parseChinese(raw)
      : /^\+?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/u.test(raw) ? Number(raw.replace(/,/g, '')) : null;
    if (value === null || !Number.isSafeInteger(value) || value < 0) continue;
    const suffix = normalized.slice(end);
    const unitMatch = unitPattern?.exec(suffix);
    if (unitPattern && !unitMatch) continue;
    if (unitMatch && /^\s*半/u.test(suffix.slice(unitMatch[0].length))) continue;
    const index = starts[start], originalEnd = ends[end - 1];
    results.push({ value, raw: text.slice(index, originalEnd), index, end: originalEnd, notation });
  }
  return results;
}
