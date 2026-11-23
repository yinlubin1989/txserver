import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './testLoader.mjs';

const { calculateLedger } = loadModule('ledger.ts');
const { validateReport } = loadModule('../financeLedger/validation.ts');
function item(id, category, amount, source, extra = {}) {
  return { id, category, label: id, amount, unitPrice: null, quantity: null, quantityUnit: null,
    source, includedIn: null, inclusionSource: null, commissionFor: null, ...extra };
}
function sale(source, price, quantity) {
  return item('花束', 'income', null, source, { unitPrice: price, quantity, quantityUnit: '束' });
}
function record(items, checks = []) {
  return { year: null, month: 3, day: 28, items, checks,
    source: `3月28日\n${items.map(entry => entry.source).join('\n')}\n${checks.map(check => check.source).join('\n')}` };
}
function run(records, text = records.map(entry => entry.source).join('\n')) {
  const result = calculateLedger({ records }, text);
  assert.equal(validateReport(result), result, '宽容统计结果仍符合账本保存与分享契约');
  return result;
}
function zeroPacket() { return item('红包', 'redPacket', '0', '红包0元'); }
function assertReview(result) {
  assert.equal(result.status, 'completed');
  assert.ok(result.warnings.some(warning => warning.severity === 'review' && warning.date === '3月28日'),
    '可计算但未核实的内容应在对应日期展示核对备注');
}

test('用户随手记“3月28 288一束花”直接统计并按默认提成计算', () => {
  const text = '3月28 288一束花';
  const entry = { ...record([sale('288一束花', '288', 1)]), source: text };
  const result = run([entry], text);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.period, { year: null, month: 3 });
  assert.deepEqual(result.totals, { days: 1, incomeCents: 28800, expenseCents: 4000, profitCents: 24800 });
  assert.equal(result.dailyRows[0].day, 28);
  assert.equal(result.dailyRows[0].details[0].source, '288一束花');
  assert.equal(result.dailyRows[0].details[0].quantity, 1);
  assert.equal(result.dailyRows[0].details[0].quantityUnit, '束');
  assert.ok(result.warnings.every(warning => warning.severity === 'info'));
});

test('中文数量、空格和全角价格不合并成新数字，也不产生不必要的强提示', () => {
  for (const [source, quantity] of [
    ['368两束', 2], ['368 十束', 10], ['368二十一束', 21], ['368一百零一束', 101], ['３６８ 一 束花', 1],
  ]) {
    const result = run([record([sale(source, '368', quantity)])]);
    assert.deepEqual(result.totals, { days: 1, incomeCents: 36800 * quantity, expenseCents: 6000 * quantity, profitCents: 30800 * quantity });
    assert.equal(result.dailyRows[0].details[0].source, source);
    assert.ok(result.warnings.every(warning => warning.severity === 'info'), source);
  }
});

test('模型对原文标点或措辞的转录不一致不阻止已知金额统计', () => {
  const entry = record([item('收入', 'income', '100', '收入100元'), zeroPacket()]);
  entry.source = '3月28 收到100元，红包0元';
  const result = run([entry]);
  assert.deepEqual(result.totals, { days: 1, incomeCents: 10000, expenseCents: 0, profitCents: 10000 });
  assertReview(result);
});

test('原文金额或数量未能逐一对应时继续按识别值暂计并提示', () => {
  const amountResult = run([record([item('收入', 'income', '100', '收入一百元'), zeroPacket()])]);
  assert.equal(amountResult.totals.incomeCents, 10000);
  assertReview(amountResult);
  const quantityResult = run([record([sale('288二束花', '288', 3), zeroPacket()])]);
  assert.equal(quantityResult.totals.incomeCents, 86400);
  assertReview(quantityResult);
});

test('部分费用漏识别时保留可计算收入，同时明确提示该费用待核对', () => {
  const result = run([record([
    item('收入', 'income', '500', '收入500元'), item('进货', 'purchase', null, '进货320元'), zeroPacket(),
  ])]);
  assert.equal(result.totals.incomeCents, 50000);
  assertReview(result);
  assert.ok(result.warnings.some(warning => warning.severity === 'review' && warning.message.includes('进货')));
});

test('不确定的包含关系不会排除费用，也不阻止结果展示', () => {
  const source = '采购100元，耗材20元是否已包含？';
  const items = [
    item('采购', 'purchase', '100', source),
    item('耗材', 'supplies', '20', source, { includedIn: '采购', inclusionSource: source }),
  ];
  const input = [record(items)];
  const original = structuredClone(input);
  const result = run(input);
  assert.deepEqual(result.totals, { days: 1, incomeCents: 0, expenseCents: 12000, profitCents: -12000 });
  assert.equal(result.dailyRows[0].details.find(detail => detail.category === 'supplies').included, false);
  assertReview(result);
  assert.deepEqual(input, original, '修复不明确关系不得改写调用方原始抽取结果');
});

test('包含费用的父项未找到时单列已知费用并给出备注', () => {
  const source = '耗材20元已包含于其他费用';
  const result = run([record([item('耗材', 'supplies', '20', source, { includedIn: '未识别费用', inclusionSource: source })])]);
  assert.equal(result.totals.expenseCents, 2000);
  assert.equal(result.dailyRows[0].details[0].included, false);
  assertReview(result);
});

test('提成关联未找到时保留原文费用，避免与默认提成重复', () => {
  const result = run([record([
    sale('368一束', '368', 1),
    item('提成', 'commission', '20', '提成20元', { commissionFor: '未识别销售' }),
  ])]);
  assert.equal(result.totals.incomeCents, 36800);
  assert.equal(result.totals.expenseCents, 2000);
  assertReview(result);
});

test('无法校验的可选小计不阻止已知明细，明确收入合计差异仍会提示', () => {
  const items = [item('收入', 'income', '100', '收入100元'), zeroPacket()];
  const malformed = run([record(items, [{ amount: '100', itemIds: ['未识别明细'], source: '小计100元' }])]);
  assert.equal(malformed.totals.incomeCents, 10000);
  assertReview(malformed);
  const entry = record([sale('288两束', '288', 2), zeroPacket()], [{ amount: '500', itemIds: ['花束'], source: '收入合计500元' }]);
  const result = run([entry, entry]);
  assert.equal(result.totals.incomeCents, 57600);
  assert.equal(result.totals.days, 1);
  assert.ok(result.warnings.some(warning => warning.code === 'DUPLICATE'));
  assert.ok(result.warnings.some(warning => warning.code === 'INCOME_TOTAL_MISMATCH' && warning.severity === 'review'));
});

test('完全没有可计算金额不能伪装全零成功，明确0仍是有效账目', () => {
  for (const entry of [item('进货', 'purchase', null, '进货'), sale('288 束', '288', null)]) {
    assert.throws(() => run([record([entry])]), error => typeof error.code === 'string');
  }
  const zero = run([record([item('收入', 'income', '0', '收入0元')])]);
  assert.equal(zero.status, 'completed');
  assert.deepEqual(zero.totals, { days: 1, incomeCents: 0, expenseCents: 0, profitCents: 0 });
  const zeroQuantity = run([record([sale('288零束', '288', 0)])]);
  assert.equal(zeroQuantity.status, 'completed');
  assert.equal(zeroQuantity.totals.incomeCents, 0);
});

test('宽容文字不放宽模型结构、非法金额或整数溢出', () => {
  for (const amount of ['NaN', '1e3', '1.001', '']) {
    assert.throws(() => run([record([item('收入', 'income', amount, '收入100元')])]), error => error.code === 'INVALID_EXTRACTION');
  }
  assert.throws(() => run([record([sale('单价999999999999元 100束', '999999999999', 100)])]), error => error.code === 'INVALID_EXTRACTION');
  assert.throws(() => run([]), error => error.code === 'NO_RECORDS');
  const missingField = record([item('收入', 'income', '100', '收入100元')]);
  delete missingField.items[0].amount;
  assert.throws(() => run([missingField]), error => error.code === 'INVALID_EXTRACTION');
});
