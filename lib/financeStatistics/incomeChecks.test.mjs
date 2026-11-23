import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './testLoader.mjs';
const { calculateLedger } = loadModule('ledger.ts');
const { readIncomeTotals, incomeChecks } = loadModule('incomeChecks.ts');
const { multiply } = loadModule('money.ts');
const { validateReport } = loadModule('../financeLedger/validation.ts');

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
const run = records => validateReport(calculateLedger({ records }, records.map(record => record.source).join('\n')));

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

test('合计与明细重复识别时只计明细，原文合计遗漏时保留结果并提示', () => {
  const record = example(); record.items.push(item('total', 'income', '收入合计:3840元', '3840'));
  const before = structuredClone(record);
  const result = run([record]);
  assert.equal(result.totals.incomeCents, 384800);
  assert.ok(result.warnings.some(w => w.severity === 'info' && /合计仅用于核对/.test(w.message)));
  assert.ok(result.warnings.some(w => w.code === 'INCOME_TOTAL_MISMATCH'));
  assert.equal(result.dailyRows[0].details.some(detail => detail.source === '收入合计:3840元'), false);
  assert.deepEqual(record, before);
  const clipped = example({ total: null });
  const partial = calculateLedger({ records: [clipped] }, `${clipped.source}\n收入合计:3840元`);
  assert.equal(partial.totals.incomeCents, 384800);
  assert.ok(partial.warnings.some(w => w.severity === 'review' && /收入合计未能完整核对/.test(w.message)));
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
  record.checks = [];
  const unscoped = run([record]);
  assert.equal(unscoped.totals.incomeCents, 30000);
  assert.ok(unscoped.warnings.some(w => w.severity === 'review' && /明细范围不明确/.test(w.message)));
  assert.equal(unscoped.warnings.some(w => w.code === 'INCOME_TOTAL_MISMATCH'), false);
});

test('同一合计被重复抽成金额项目时仅保留一份', () => {
  const record = { year: null, month: 10, day: 1, checks: [], source: '10月1日\n收入合计100元\n红包0元',
    items: [item('first', 'income', '收入合计100元', '100'), item('duplicate', 'income', '收入合计100元', '100'), item('red', 'redPacket', '红包0元', '0')],
  };
  const result = run([record]);
  assert.equal(result.totals.incomeCents, 10000);
  assert.ok(result.warnings.some(w => w.severity === 'info' && /只计入一次/.test(w.message)));
});

test('部分合计范围不明确时仍核对另一笔已明确的收入合计', () => {
  const record = { year: null, month: 10, day: 1,
    source: '10月1日\n早场收入100元，收入合计110元\n晚场收入200元，收入合计200元\n红包0元',
    items: [item('morning', 'income', '早场收入100元', '100'), item('evening', 'income', '晚场收入200元', '200'), item('red', 'redPacket', '红包0元', '0')],
    checks: [{ amount: '110', source: '收入合计110元', itemIds: ['morning'] }],
  };
  const result = run([record]);
  assert.equal(result.totals.incomeCents, 30000);
  assert.ok(result.warnings.some(w => w.code === 'INCOME_TOTAL_MISMATCH' && /少10.00元/.test(w.message)));
  assert.ok(result.warnings.some(w => w.severity === 'review' && /明细范围不明确/.test(w.message)));
});

test('合计格式不明确不阻断有效明细，也不丢弃其他已明确范围的核对', () => {
  const record = { year: null, month: 10, day: 1,
    source: '10月1日\n早场收入100元，收入合计110元\n晚场收入200元，收入合计2,00元\n红包0元',
    items: [item('morning', 'income', '早场收入100元', '100'), item('evening', 'income', '晚场收入200元', '200'), item('red', 'redPacket', '红包0元', '0')],
    checks: [{ amount: '110', source: '收入合计110元', itemIds: ['morning'] }],
  };
  const result = run([record]);
  assert.equal(result.totals.incomeCents, 30000);
  assert.ok(result.warnings.some(w => w.severity === 'review' && /金额格式不明确/.test(w.message)));
  assert.ok(result.warnings.some(w => w.code === 'INCOME_TOTAL_MISMATCH' && /少10.00元/.test(w.message)));
});

test('没有识别出收入项目时明确提示收入未计入，其他已知账目仍可展示', () => {
  const record = { year: null, month: 10, day: 1, source: '10月1日\n收入合计100元\n进货20元', checks: [],
    items: [item('purchase', 'purchase', '进货20元', '20')],
  };
  const result = run([record]);
  assert.equal(result.totals.incomeCents, 0);
  assert.equal(result.totals.expenseCents, 2000);
  assert.ok(result.warnings.some(w => w.severity === 'review' && /该笔收入暂未计入/.test(w.message)));
});

test('无法核对的重复小计不保留伪差异且不修改模型输出', () => {
  const record = example({ total: null });
  record.source += '\n早场收入合计100元\n晚场收入合计200元';
  record.checks = [
    { amount: '100', itemIds: ['standard'], source: '早场收入合计100元' },
    { amount: '100', itemIds: ['special'], source: '早场收入合计100元' },
    { amount: '200', itemIds: ['special'], source: '晚场收入合计200元' },
  ];
  const before = structuredClone(record);
  const result = incomeChecks(record);
  assert.equal(result.checks.length, 1);
  assert.equal(result.incomeChecks.size, 1);
  assert.ok(result.warnings.some(w => w.severity === 'review'));
  assert.deepEqual(record, before);
});

test('同段多份合计与明细重复抽取时不双计，缺少范围只增加核对备注', () => {
  const record = { year: null, month: 10, day: 1,
    source: '10月1日\n早场收入100元，收入合计100元\n晚场收入200元，收入合计200元\n红包0元',
    items: [item('morning', 'income', '早场收入100元', '100'), item('evening', 'income', '晚场收入200元', '200'),
      item('morningTotal', 'income', '收入合计100元', '100'), item('eveningTotal', 'income', '收入合计200元', '200'), item('red', 'redPacket', '红包0元', '0')],
    checks: [],
  };
  const unscoped = run([record]);
  assert.equal(unscoped.totals.incomeCents, 30000);
  assert.ok(unscoped.warnings.some(w => w.severity === 'review' && /未另行叠加/.test(w.message)));
  record.checks = [
    { amount: '100', source: '收入合计100元', itemIds: ['morning', 'morningTotal'] },
    { amount: '200', source: '收入合计200元', itemIds: ['evening', 'eveningTotal'] },
  ];
  const scoped = run([record]);
  assert.equal(scoped.totals.incomeCents, 30000);
  assert.equal(scoped.warnings.some(w => w.code === 'INCOME_TOTAL_MISMATCH'), false);
});

test('多个独立合计中有一笔只有合计时保留明确范围，不把所有合计都删掉', () => {
  const record = { year: null, month: 10, day: 1,
    source: '10月1日\n早场收入合计100元\n晚场收入200元，收入合计200元\n红包0元',
    items: [item('morningTotal', 'income', '早场收入合计100元', '100'), item('evening', 'income', '晚场收入200元', '200'),
      item('eveningTotal', 'income', '收入合计200元', '200'), item('red', 'redPacket', '红包0元', '0')],
    checks: [{ amount: '100', source: '早场收入合计100元', itemIds: ['morningTotal'] },
      { amount: '200', source: '收入合计200元', itemIds: ['evening'] }],
  };
  assert.equal(run([record]).totals.incomeCents, 30000);
  record.items = record.items.filter(entry => entry.id !== 'evening');
  record.checks = [];
  assert.equal(run([record]).totals.incomeCents, 30000);
});

test('金额型销售引用了较长原文时不能仅凭含合计文字就删掉收入', () => {
  const source = '10月1日\n早场收入100元，晚场收入200元，收入合计300元\n红包0元';
  const record = { year: null, month: 10, day: 1, source, checks: [],
    items: [item('morning', 'income', source, '100'), item('evening', 'income', source, '200'), item('red', 'redPacket', '红包0元', '0')],
  };
  assert.equal(run([record]).totals.incomeCents, 30000);
});

test('金额相同但原文分别属于早晚场的独立合计各计一次', () => {
  const record = { year: null, month: 10, day: 1,
    source: '10月1日\n早场收入合计100元\n晚场收入合计100元\n红包0元', checks: [],
    items: [item('morning', 'income', '早场收入合计100元', '100'), item('evening', 'income', '晚场收入合计100元', '100'), item('red', 'redPacket', '红包0元', '0')],
  };
  assert.equal(run([record]).totals.incomeCents, 20000);
});

test('仅有合计和未填写模板时使用合计，不把空模板当作销售明细', () => {
  const empty = item('empty', 'income', '368 束 元', null, { unitPrice: '368', quantityUnit: '束' });
  const total = item('total', 'income', '收入合计100元', '100');
  const red = item('red', 'redPacket', '红包0元', '0');
  const record = { year: null, month: 10, day: 1, items: [empty, total, red], checks: [], source: '10月1日\n368 束 元\n收入合计100元\n红包0元' };
  assert.equal(run([record]).totals.incomeCents, 10000);
});
