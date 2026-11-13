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
function incompleteWarning(result, date = '10月1日') {
  assert.equal(result.status, 'completed');
  const warning = result.warnings.find(item => item.code === 'COMMISSION_INCOMPLETE' && item.date === date);
  assert.ok(warning, '缺少按日期展示的提成核对说明');
  assert.equal(warning.severity, 'review');
  assert.equal(result.dailyRows.find(row => row.day === Number(date.match(/月(\d+)日/)[1])).commissionCheck.status, 'incomplete');
  return warning;
}
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
test('无红包且数量、单位、特殊提成或销售明细缺失，保留已知收入并提示未计费用', () => {
  for (const [item, incomeCents] of [
    [entry('数量未知', 'income', '736', { unitPrice: '368', quantityUnit: '束', source: '368元 束 收入736元' }), 73600],
    [sale('单位未知', '288', 2, null), 57600],
    [sale('特殊价', '168', 1), 16800],
    [entry('收入合计', 'income', '1000'), 100000],
  ]) {
    const result = run([record(1, [item])]);
    assert.deepEqual(result.totals, { days: 1, incomeCents, expenseCents: 0, profitCents: incomeCents });
    const warning = incompleteWarning(result);
    assert.doesNotMatch(warning.message, /红包按原文0\.00元|已按原文红包入账/);
    assert.equal(result.breakdown.expenses.reduce((total, expense) => total + expense.amountCents, 0), 0);
  }
});
test('有红包但缺核对信息返回incomplete，仍按实际红包支出', () => {
  const result = run([record(1, [entry('收入合计', 'income', '1000'), entry('红包', 'redPacket', '100')])]);
  assert.equal(result.totals.expenseCents, 10000);
  assert.equal(result.dailyRows[0].commissionCheck.status, 'incomplete');
  assert.equal(result.warnings.find(warning => warning.code === 'COMMISSION_INCOMPLETE').severity, 'info');
});
test('8月25日随手记无金额无红包，按销量计收入并补已知默认提成', () => {
  const source = '阿雯:\n8月25日拍摄\n售出花束 8束\n368    6束\n288    1束。       328。\n1束';
  const items = [
    sale('368花束', '368', 6), sale('288花束', '288', 1), sale('328花束', '328', 1),
  ].map((item, index) => ({ ...item, source: ['368    6束', '288    1束。', '328。\n1束'][index] }));
  const result = calculateLedger({ records: [{ year: null, month: 8, day: 25, source, items, checks: [] }] }, source);
  assert.deepEqual(result.totals, { days: 1, incomeCents: 282400, expenseCents: 40000, profitCents: 242400 });
  assert.equal(expenses(result, 'commission'), 40000);
  assert.equal(result.breakdown.incomeByPrice.reduce((total, group) => total + group.quantity, 0), 8);
  const warning = incompleteWarning(result, '8月25日');
  assert.match(warning.message, /328/);
  assert.match(warning.message, /400\.00/);
  assert.match(warning.message, /未计|暂未|无法补算/);
});
test('未知特殊提成不妨碍同日其他记录补算，重复段落仍只计一次', () => {
  const first = record(1, [sale('花束', '368', 2)]);
  const second = record(1, [sale('特殊花束', '328', 1)]);
  const third = record(2, [sale('288花束', '288', 1)]);
  const result = run([first, first, second, third]);
  assert.deepEqual(result.totals, { days: 2, incomeCents: 135200, expenseCents: 16000, profitCents: 119200 });
  assert.equal(result.dailyRows[0].expenseCents, 12000);
  assert.equal(result.dailyRows[1].expenseCents, 4000);
  incompleteWarning(result);
  assert.ok(result.warnings.some(warning => warning.code === 'DUPLICATE'));
  assert.ok(result.warnings.some(warning => warning.code === 'COMMISSION_INFERRED' && warning.severity === 'info'));
});
test('无法关联的显式提成保留原值并暂停默认补算，明确0也不被覆盖', () => {
  for (const amount of ['20', '0']) {
    const result = run([record(1, [sale('花束', '368', 1), entry('提成', 'commission', amount)])]);
    assert.equal(result.totals.expenseCents, Number(amount) * 100);
    assert.equal(result.dailyRows[0].details.filter(item => item.category === 'commission').length, 1);
    incompleteWarning(result);
  }
});
test('未关联提成已含采购费时不再补默认，关联的显式提成仍保留', () => {
  const flower = sale('主花束', '368', 1);
  const special = sale('特价花束', '168', 1);
  const source = '采购100元已包含提成20元';
  const purchase = entry('采购', 'purchase', '100', { source });
  const includedFee = entry('提成', 'commission', '20', { source, includedIn: purchase.id, inclusionSource: source });
  const result = run([record(1, [flower, special, commission('特殊提成', '15', special), purchase, includedFee])]);
  assert.equal(result.totals.expenseCents, 11500);
  assert.equal(expenses(result, 'commission'), 1500);
  assert.equal(result.dailyRows[0].details.find(item => item.label === '提成').included, true);
  incompleteWarning(result);
});
test('标准价提成金额留白使用默认；已知提成与留白并存只计已知值', () => {
  const flower = sale('花束', '368', 2);
  const blankFee = commission('未填写提成', null, flower);
  const blank = run([record(1, [flower, blankFee])]);
  assert.equal(blank.totals.expenseCents, 12000);
  assert.equal(blank.status, 'completed');
  for (const amount of ['50', '0']) {
    const result = run([record(1, [flower, commission('已填写提成', amount, flower), blankFee])]);
    assert.equal(result.totals.expenseCents, Number(amount) * 100);
    incompleteWarning(result);
  }
});
test('模型漏掉原文已写的关联提成金额仍应拒绝，不能冒充留白套默认', () => {
  const flower = sale('花束', '368', 2);
  const missedAmount = commission('提成', null, flower, { source: `${flower.source}，提成50元` });
  assert.throws(() => run([record(1, [flower, missedAmount])]), error => error.code === 'INVALID_EXTRACTION');
});
test('未关联提成金额留白不阻止默认补算，特殊价留白继续提示', () => {
  const main = sale('标准花束', '368', 1);
  const special = sale('特殊花束', '328', 1);
  const result = run([record(1, [main, special, entry('提成', 'commission', null)])]);
  assert.equal(result.totals.incomeCents, 69600);
  assert.equal(result.totals.expenseCents, 6000);
  incompleteWarning(result);
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
test('原文红包不含提成与约定冲突时保留实际红包并醒目提示', () => {
  const flower = sale('花束', '368', 1);
  const source = `${flower.source}，红包60元不含提成15元`;
  const red = entry('红包', 'redPacket', '60', { source });
  const fee = commission('提成', '15', flower, { source });
  const result = run([record(1, [flower, red, fee])]);
  assert.equal(result.totals.expenseCents, 6000);
  assert.equal(expenses(result, 'commission'), 0);
  assert.equal(result.dailyRows[0].details.find(item => item.category === 'commission').included, true);
  assert.match(incompleteWarning(result).message, /不含|另计|冲突/);
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
