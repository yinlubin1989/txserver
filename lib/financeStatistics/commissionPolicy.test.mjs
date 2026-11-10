import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadModule } from './testLoader.mjs';
const { calculateLedger } = loadModule('ledger.ts');
function entry(id, category, amount, extra = {}) {
  return { id, category, label: id, amount, unitPrice: null, quantity: null, quantityUnit: null,
    source: `${id}${amount ?? ''}元`, includedIn: null, inclusionSource: null, commissionFor: null, ...extra };
}
function sale(id, price, quantity, unit = '束') {
  return entry(id, 'income', null, { unitPrice: price, quantity, quantityUnit: unit,
    source: `${price}元 ${quantity === null ? '' : quantity}${unit ?? '（单位未注明）'}` });
}
function commission(id, amount, target, extra = {}) {
  return entry(id, 'commission', amount, { commissionFor: target.id, source: `${target.source}，提成${amount ?? ''}元`, ...extra });
}
function record(day, items, checks = []) {
  return { year: null, month: 10, day, items, checks, source: `10月${day}日\n${items.map(item => item.source).join('\n')}\n${checks.map(check => check.source).join('\n')}` };
}
function run(records) { return calculateLedger({ records }, records.map(record => record.source).join('\n')); }
function expenses(result, category) { return result.breakdown.expenses.find(item => item.category === category).amountCents; }
function october28(withRed = true) {
  const main = sale('368花束', '368', 7);
  const secondary = sale('288花束', '288', 1);
  const special = sale('168花束', '168', 1);
  const items = [main, secondary, special, commission('特殊提成', '15', special), entry('进货', 'purchase', '1138')];
  if (withRed) items.push(entry('红包', 'redPacket', '395'));
  return record(28, items);
}
test('10月28日红包395包含显式15，预计475只核对差80', () => {
  const result = run([october28()]);
  assert.deepEqual(result.totals, { days: 1, incomeCents: 303200, expenseCents: 153300, profitCents: 149900 });
  assert.equal(expenses(result, 'redPacket'), 39500);
  assert.equal(expenses(result, 'commission'), 0);
  assert.equal(result.dailyRows[0].commissionCheck.status, 'mismatch');
  assert.equal(result.warnings.find(warning => warning.code === 'COMMISSION_MISMATCH').severity, 'info');
  assert.match(result.dailyRows[0].commissionCheck.message, /475/);
  assert.match(result.dailyRows[0].commissionCheck.message, /80/);
  const explicit = result.dailyRows[0].details.find(item => item.category === 'commission');
  assert.equal(explicit.amountCents, 1500);
  assert.equal(explicit.included, true);
  assert.equal(typeof explicit.accountingNote, 'string');
});
test('没有红包才补算7×60＋40＋15，支出1613利润1419', () => {
  const result = run([october28(false)]);
  assert.deepEqual(result.totals, { days: 1, incomeCents: 303200, expenseCents: 161300, profitCents: 141900 });
  assert.equal(expenses(result, 'redPacket'), 0);
  assert.equal(expenses(result, 'commission'), 47500);
  assert.equal(result.dailyRows[0].commissionCheck.status, 'inferred');
  assert.equal(result.warnings.find(warning => warning.code === 'COMMISSION_INFERRED').severity, 'info');
});
test('明确红包0不能被默认提成覆盖；红包留白按无实际额处理', () => {
  const flower = sale('花束', '368', 2);
  const zero = run([record(1, [flower, entry('红包', 'redPacket', '0')])]);
  assert.equal(zero.totals.expenseCents, 0);
  assert.equal(zero.dailyRows[0].commissionCheck.status, 'mismatch');
  const blank = run([record(1, [flower, entry('红包', 'redPacket', null, { source: '红包' })])]);
  assert.equal(blank.totals.expenseCents, 12000);
  assert.equal(blank.dailyRows[0].commissionCheck.status, 'inferred');
});
test('先去重再按日汇总；别段红包覆盖同日提成且记录id可重复', () => {
  const firstSale = sale('sale', '368', 1);
  const secondSale = sale('sale', '288', 1);
  const first = record(1, [firstSale]);
  const second = record(1, [secondSale, commission('fee', '30', secondSale)]);
  const red = record(1, [entry('红包', 'redPacket', '90')]);
  const result = run([first, first, second, red]);
  assert.equal(result.totals.incomeCents, 65600);
  assert.equal(result.totals.expenseCents, 9000);
  assert.equal(result.dailyRows[0].commissionCheck.status, 'matched');
  assert.ok(result.warnings.some(warning => warning.code === 'DUPLICATE' && warning.severity === 'info'));
  const noRed = run([first, first, second]);
  assert.equal(noRed.totals.expenseCents, 9000);
  assert.equal(noRed.dailyRows[0].commissionCheck.status, 'inferred');
});
test('标准价位有明确对应提成时覆盖默认，不再加默认40/60', () => {
  const flower = sale('花束', '368', 2);
  const result = run([record(1, [flower, commission('特别提成', '50', flower)])]);
  assert.equal(result.totals.expenseCents, 5000);
  assert.equal(expenses(result, 'commission'), 5000);
});
test('特殊价裸提成15是单次总额，每束15才乘数量', () => {
  const flower = sale('花束', '168', 2);
  const flat = run([record(1, [flower, commission('提成', '15', flower)])]);
  assert.equal(flat.totals.expenseCents, 1500);
  const perBouquet = commission('提成', null, flower, { unitPrice: '15', quantity: 2, quantityUnit: '束', source: `${flower.source}，提成每束15元` });
  const per = run([record(1, [flower, perBouquet])]);
  assert.equal(per.totals.expenseCents, 3000);
});
test('每束提成行金额冲突按最终入账关系分级，红包覆盖后仅为info', () => {
  const flower = sale('花束', '168', 2);
  const fee = commission('提成', '20', flower, {
    unitPrice: '15', quantity: 2, quantityUnit: '束', source: `${flower.source}，每束提成15元，提成共20元`,
  });
  for (const withPacket of [false, true]) {
    const items = withPacket ? [flower, fee, entry('红包', 'redPacket', '40')] : [flower, fee];
    const result = run([record(1, items)]);
    assert.deepEqual(result.totals, { days: 1, incomeCents: 33600, expenseCents: withPacket ? 4000 : 3000, profitCents: withPacket ? 29600 : 30600 });
    const detail = result.dailyRows[0].details.find(item => item.category === 'commission');
    assert.equal(detail.amountCents, 3000);
    assert.equal(detail.included, withPacket);
    assert.equal(result.warnings.find(warning => warning.code === 'ITEM_MISMATCH').severity, withPacket ? 'info' : 'review');
    assert.equal(expenses(result, 'commission'), withPacket ? 0 : 3000);
  }
});
test('无红包且必要数量、单位、特殊提成或销售明细缺失应要求补充', () => {
  for (const items of [
    [entry('数量未知', 'income', '736', { unitPrice: '368', quantityUnit: '束', source: '368元 束 收入736元' })],
    [sale('单位未知', '288', 2, null)],
    [sale('特殊价', '168', 1)],
    [entry('收入合计', 'income', '1000')],
  ]) assert.throws(() => run([record(1, items)]), error => error.httpStatus === 422);
});
test('有红包但缺核对信息返回incomplete，仍按实际红包支出', () => {
  const result = run([record(1, [entry('收入合计', 'income', '1000'), entry('红包', 'redPacket', '100')])]);
  assert.equal(result.totals.expenseCents, 10000);
  assert.equal(result.dailyRows[0].commissionCheck.status, 'incomplete');
  assert.equal(result.warnings.find(warning => warning.code === 'COMMISSION_INCOMPLETE').severity, 'info');
});
test('有收入却无法关联显式提成时，无红包不得叠加默认猜结果', () => {
  assert.throws(() => run([record(1, [sale('花束', '368', 1), entry('提成', 'commission', '20')])]), error => error.httpStatus === 422);
});
test('非束商品不套40/60默认，纯支出不虚构预计或补算0', () => {
  const nonBouquet = run([record(1, [sale('单枝', '368', 2, '支')])]);
  assert.equal(nonBouquet.totals.expenseCents, 0);
  assert.equal(nonBouquet.dailyRows[0].commissionCheck, null);
  const onlyExpense = run([record(1, [entry('红包', 'redPacket', '100'), entry('进货', 'purchase', '200')])]);
  assert.equal(onlyExpense.totals.expenseCents, 30000);
  assert.equal(onlyExpense.dailyRows[0].commissionCheck, null);
});
test('可由原文单价人数计算的红包按实际额入账而非叠加默认', () => {
  const flower = sale('花束', '368', 1);
  const red = entry('红包', 'redPacket', null, { unitPrice: '20', quantity: 2, quantityUnit: '人', source: '红包每人20元，2人' });
  const result = run([record(1, [flower, red])]);
  assert.equal(result.totals.expenseCents, 4000);
  assert.equal(result.dailyRows[0].commissionCheck.status, 'mismatch');
});
test('提成仅写单价15但数量未注明，不得当成明确0或裸总15', () => {
  const flower = sale('花束', '168', 2);
  const fee = commission('提成', null, flower, { unitPrice: '15', quantity: null, source: `${flower.source}，提成单价15元，数量未注明` });
  assert.throws(() => run([record(1, [flower, fee])]), error => error.httpStatus === 422 || error.code === 'INVALID_EXTRACTION');
});
test('红包包含于其他费用，核对使用红包原值但支出不重复', () => {
  const flower = sale('花束', '288', 1);
  const source = '采购100元已包含红包40元';
  const purchase = entry('采购', 'purchase', '100', { source });
  const red = entry('红包', 'redPacket', '40', { source, includedIn: purchase.id, inclusionSource: source });
  const result = run([record(1, [flower, purchase, red])]);
  assert.equal(result.totals.expenseCents, 10000);
  assert.equal(expenses(result, 'redPacket'), 0);
  assert.equal(result.dailyRows[0].commissionCheck.status, 'matched');
});
test('标准价的显式提成已包含在采购费，覆盖默认且不重复计费用', () => {
  const flower = sale('花束', '368', 1);
  const source = `${flower.source}，采购100元已包含提成20元`;
  const purchase = entry('采购', 'purchase', '100', { source });
  const fee = commission('提成', '20', flower, { source, includedIn: purchase.id, inclusionSource: source });
  const result = run([record(1, [flower, purchase, fee])]);
  assert.equal(result.totals.expenseCents, 10000);
  assert.equal(expenses(result, 'commission'), 0);
});
test('红包包含子红包，实际核对额与费用均只计父红包', () => {
  const source = '红包合计100元已包含小红包20元';
  const parent = entry('红包合计', 'redPacket', '100', { source });
  const child = entry('小红包', 'redPacket', '20', { source, includedIn: parent.id, inclusionSource: source });
  const result = run([record(1, [sale('368花束', '368', 1), sale('288花束', '288', 1), parent, child])]);
  assert.equal(result.totals.expenseCents, 10000);
  assert.equal(expenses(result, 'redPacket'), 10000);
  assert.equal(result.dailyRows[0].commissionCheck.status, 'matched');
});
test('同销售的提成包含子提成，预计提成与费用均只计父提成', () => {
  const flower = sale('花束', '368', 2);
  const source = `${flower.source}，提成合计100元已包含小提成20元`;
  const parent = commission('提成合计', '100', flower, { source });
  const child = commission('小提成', '20', flower, { source, includedIn: parent.id, inclusionSource: source });
  for (const packets of [[], [entry('红包', 'redPacket', '100')]]) {
    const result = run([record(1, [flower, parent, child, ...packets])]);
    assert.equal(result.totals.expenseCents, 10000);
    assert.equal(result.dailyRows[0].commissionCheck.status, packets.length ? 'matched' : 'inferred');
    assert.match(result.dailyRows[0].commissionCheck.message, /100\.00/);
    assert.doesNotMatch(result.dailyRows[0].commissionCheck.message, /120\.00/);
  }
});
test('无红包特殊价的极大每束提成乘法溢出必须拒绝', () => {
  const flower = sale('花束', '1', 100);
  const fee = commission('提成', null, flower, { unitPrice: '999999999999', quantity: 100, quantityUnit: '束', source: `${flower.source}，每束提成999999999999元` });
  assert.throws(() => run([record(1, [flower, fee])]), error => error.code === 'INVALID_EXTRACTION');
});
test('原文明示红包不含提成与固定实际总额口径冲突时拒绝猜测', () => {
  const flower = sale('花束', '368', 1);
  const source = `${flower.source}，红包60元不含提成15元`;
  const red = entry('红包', 'redPacket', '60', { source });
  const fee = commission('提成', '15', flower, { source });
  assert.throws(() => run([record(1, [flower, red, fee])]), error => error.httpStatus === 422 || error.code === 'INVALID_EXTRACTION');
});
test('commissionFor不能指向不存在/非收入/跨记录对象，也不能用于非提成', () => {
  const flower = sale('flower', '368', 1);
  const red = entry('红包', 'redPacket', '60');
  for (const fee of [
    commission('fee', '15', flower, { commissionFor: 'missing' }),
    commission('fee', '15', flower, { commissionFor: red.id }),
    commission('fee', '15', flower, { source: '提成15元' }),
  ]) assert.throws(() => run([record(1, [flower, red, fee])]), error => error.code === 'INVALID_EXTRACTION');
  assert.throws(() => run([record(1, [{ ...flower, commissionFor: 'flower' }, red])]), error => error.code === 'INVALID_EXTRACTION');
  assert.throws(() => run([record(1, [flower]), record(1, [red, commission('fee', '15', flower)])]), error => error.code === 'INVALID_EXTRACTION');
});
test('整月原文实际红包口径总额与全部支出分类一致', () => {
  const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/october.extracted.json', import.meta.url), 'utf8'));
  const text = fs.readFileSync(new URL('./fixtures/october.txt', import.meta.url), 'utf8');
  const result = calculateLedger(raw, text);
  assert.deepEqual(result.totals, { days: 25, incomeCents: 8079800, expenseCents: 2472478, profitCents: 5607322 });
  assert.equal(expenses(result, 'commission'), 0);
  assert.equal(expenses(result, 'redPacket'), 1066000);
  assert.equal(result.dailyRows.find(row => row.day === 28).expenseCents, 153300);
  assert.equal(result.dailyRows.filter(row => row.commissionCheck.status === 'mismatch').length, 24);
  assert.equal(result.dailyRows.find(row => row.day === 3).commissionCheck.status, 'incomplete');
  assert.equal(result.breakdown.expenses.reduce((sum, expense) => sum + expense.amountCents, 0), result.totals.expenseCents);
  assert.ok(result.warnings.length > 0);
  assert.ok(result.warnings.every(warning => warning.severity === 'info'));
});
test('零销量或空模板明确关联总提成15时，不能漏入核对并声称预计0', () => {
  for (const flower of [sale('花束', '368', 0), sale('花束', '368', null)]) {
    try {
      const result = run([record(1, [flower, commission('提成', '15', flower)])]);
      assert.equal(result.totals.expenseCents, 1500);
      assert.equal(result.dailyRows[0].commissionCheck.status, 'inferred');
      assert.match(result.dailyRows[0].commissionCheck.message, /15/);
    } catch (error) {
      // Rejecting an ambiguous empty-sale association is also valid; silently computing 0 is not.
      assert.ok(error.httpStatus === 422 || error.code === 'INVALID_EXTRACTION', String(error));
    }
  }
});
