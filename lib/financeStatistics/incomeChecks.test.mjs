import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './testLoader.mjs';
const { calculateLedger } = loadModule('ledger.ts');
const { readIncomeTotals } = loadModule('incomeChecks.ts');
const { multiply } = loadModule('money.ts');

function item(id, category, source, amount, extra = {}) {
  return { id, category, label: id, source, amount, unitPrice: null, quantity: null, quantityUnit: null, includedIn: null, inclusionSource: null, commissionFor: null, ...extra };
}
function example({ price = '168', total = '3840', rowAmount = price, amountsWritten = true, checks = [] } = {}) {
  const sales = [
    item('standard', 'income', `368元 10束${amountsWritten ? '3680元' : ''}`, amountsWritten ? '3680' : null, { unitPrice: '368', quantity: 10, quantityUnit: '束' }),
    item('special', 'income', `${price}元 1束${amountsWritten ? `${rowAmount}元` : ''}`, amountsWritten ? rowAmount : null, { unitPrice: price, quantity: 1, quantityUnit: '束' }),
  ];
  const items = [...sales, item('red', 'redPacket', '红包515元', '515')];
  const source = `10月27日\n${sales.map(row => row.source).join('\n')}\n${total === null ? '' : `收入合计:${total}元\n`}支出:红包515元。`;
  return { year: null, month: 10, day: 27, source, items, checks };
}
const run = records => calculateLedger({ records }, records.map(record => record.source).join('\n'));

test('截图160与用户文字168分别精确计算，合计不一致要求核对', () => {
  const matching = run([example({ price: '160' })]);
  assert.equal(matching.totals.incomeCents, 384000);
  assert.equal(matching.warnings.some(w => w.code === 'INCOME_TOTAL_MISMATCH'), false);
  const different = run([example()]);
  assert.equal(different.totals.incomeCents, 384800);
  const warning = different.warnings.find(w => w.code === 'INCOME_TOTAL_MISMATCH');
  assert.equal(warning.severity, 'review'); assert.equal(warning.date, '10月27日');
  for (const text of ['3840.00', '3848.00', '多8.00', '按明细计入']) assert.ok(warning.message.includes(text));
});

test('没有总额和行金额也能按单价数量算；没有合计就不生成合计差异', () => {
  const result = run([example({ total: null, amountsWritten: false })]);
  assert.equal(result.totals.incomeCents, 384800);
  assert.equal(result.warnings.some(w => w.code === 'INCOME_TOTAL_MISMATCH' || w.code === 'BLANK_AS_ZERO'), false);
});

test('只有合计没有明细时只计入一次，不推算单价销量', () => {
  const record = example(); record.items = [item('total', 'income', '收入合计:3840元', '3840'), record.items[2]];
  record.source = '10月27日\n收入合计:3840元\n支出:红包515元。';
  const result = run([record]);
  assert.equal(result.totals.incomeCents, 384000); assert.equal(result.breakdown.incomeByPrice.length, 0);
  assert.equal(result.breakdown.unclassifiedIncomeCents, 384000);
});

test('模型漏掉check或只关联标准价位时仍核对所有收入且只提示一次', () => {
  const record = example({ checks: [{ amount: '3840', source: '收入合计:3840元', itemIds: ['standard'] }] });
  const result = run([record]);
  const warnings = result.warnings.filter(w => ['TOTAL_MISMATCH', 'INCOME_TOTAL_MISMATCH'].includes(w.code));
  assert.equal(warnings.length, 1); assert.match(warnings[0].message, /3848\.00/);
});

test('行金额和总额都不一致时，先按单价数量算，再用重算值核对总额', () => {
  const result = run([example({ rowAmount: '160' })]);
  assert.equal(result.totals.incomeCents, 384800);
  assert.equal(result.warnings.filter(w => w.code === 'ITEM_MISMATCH').length, 1);
  assert.equal(result.warnings.filter(w => w.code === 'INCOME_TOTAL_MISMATCH').length, 1);
});

test('合计与明细不能双重入账，不能截去原文合计跳过核对', () => {
  const record = example(); record.items.push(item('total', 'income', '收入合计:3840元', '3840'));
  assert.throws(() => run([record]), /重复识别/);
  const clipped = example({ total: null });
  assert.throws(() => calculateLedger({ records: [clipped] }, `${clipped.source}\n收入合计:3840元`), /未被完整识别/);
});

test('同日不同记录分别核对再合并，重复段落只计一次', () => {
  const first = example({ price: '160' }); const second = example();
  const result = run([first, second, first]);
  assert.equal(result.totals.incomeCents, 768800); assert.equal(result.totals.days, 1);
  assert.equal(result.warnings.filter(w => w.code === 'INCOME_TOTAL_MISMATCH').length, 1);
  assert.ok(result.warnings.some(w => w.code === 'DUPLICATE'));
});

test('空格、全角、千分位和不同合计标签可读，留白不是零', () => {
  for (const [source, expected] of [
    ['收入 合计 ： ￥３，８４０．００ 元', '3840.00'], ['总收入 3,840元', '3840'],
    ['合计收入：人民币3840元', '3840'], ['收入共计\n3840.00元', '3840.00'],
  ]) assert.equal(readIncomeTotals(source)[0].amount, expected);
  assert.equal(readIncomeTotals('收入合计：\n10月28日').length, 0);
  assert.equal(readIncomeTotals('收入合计：待填写').length, 0);
  assert.throws(() => readIncomeTotals('收入合计3,84元'));
  assert.throws(() => readIncomeTotals('收入合计1.001元'));
});

test('整数分精确乘法、分币差异及溢出限制', () => {
  assert.equal(multiply(14608, 3), 43824);
  assert.throws(() => multiply(Number.MAX_SAFE_INTEGER, 2));
  assert.throws(() => multiply(100, 0.5));
  const result = run([example({ price: '168.01', total: '3848' })]);
  assert.equal(result.totals.incomeCents, 384801);
  assert.match(result.warnings.find(w => w.code === 'INCOME_TOTAL_MISMATCH').message, /多0\.01元/);
});

test('同段多个独立合计按明确明细范围核对，不擅自当作整日合计', () => {
  const a = item('morning', 'income', '早场收入100元', '100');
  const b = item('evening', 'income', '晚场收入200元', '200');
  const red = item('red', 'redPacket', '红包0元', '0');
  const record = { year: null, month: 10, day: 27, items: [a, b, red],
    source: '10月27日\n早场收入100元，收入合计100元\n晚场收入200元，收入合计210元\n红包0元',
    checks: [{ amount: '100', itemIds: ['morning'], source: '收入合计100元' }, { amount: '210', itemIds: ['evening'], source: '收入合计210元' }],
  };
  const result = run([record]); assert.equal(result.totals.incomeCents, 30000);
  assert.match(result.warnings.find(w => w.code === 'INCOME_TOTAL_MISMATCH').message, /少10\.00元/);
  record.checks = []; assert.throws(() => run([record]), /无法明确/);
});

test('仅有合计和未填写模板时使用合计，不把空模板当作销售明细', () => {
  const empty = item('empty', 'income', '368 束 元', null, { unitPrice: '368', quantityUnit: '束' });
  const total = item('total', 'income', '收入合计100元', '100');
  const red = item('red', 'redPacket', '红包0元', '0');
  const record = { year: null, month: 10, day: 1, items: [empty, total, red], checks: [], source: '10月1日\n368 束 元\n收入合计100元\n红包0元' };
  assert.equal(run([record]).totals.incomeCents, 10000);
});
