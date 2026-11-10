import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './testLoader.mjs';
const { calculateLedger, cents } = loadModule('ledger.ts');
function item(id, category, amount, extra = {}) { return { id, category, label: id, amount, unitPrice: null, quantity: null, quantityUnit: null, source: `${id}:${amount ?? ''}`, includedIn: null, inclusionSource: null, commissionFor: null, ...extra }; }
// Isolate non-commission tests with an explicit zero actual commission payment.
function record(day, items, checks = []) { if (!items.some(entry => entry.category === 'redPacket')) items = [...items, item('无红包支出', 'redPacket', '0', {source:'红包0元'})]; return { year: null, month: 10, day, source: `10月${day}日\n${items.map(i => i.source).join('\n')}\n${checks.map(c => c.source).join('\n')}`, items, checks }; }
function run(records) { return calculateLedger({ records }, records.map(r => r.source).join('\n')); }
// Normalized transcription of the user's 25-day sample; raw layout is exercised separately.
const sample = [
[1,4912,640,'3915.8'],[2,4256,560,null],[3,2020,260,null],[4,2864,380,null],[5,2576,350,null],
[6,4276,565,'109.8+35.2',35],[7,4108,530,'',40],[9,3520,460,'2719.3'],[10,3192,420,null,40],
[11,2864,380,'868.6+146.08'],[12,3140,400,'',10],[13,3620,470,'',10],[14,3232,430,''],[16,4056,540,'1763',10],
[17,2128,280,''],[18,3232,430,''],[19,2576,350,'2846'],[20,2954,385,'',55],[21,2496,330,''],[23,2576,350,''],
[24,3968,530,'523'],[25,2864,380,''],[26,2496,330,''],[27,3840,515,'',15],[28,3032,395,'1138',15],
];
test('完整样例数值：25天、红包采用实际提成、留白为0、明细重算', () => {
  const records = sample.map(([day,income,red,other,commission]) => {
    const items = [item('收入','income',String(income)),item('红包','redPacket',String(red))];
    if (other === null) items.push(item('进花','purchase',null));
    else if (other) other.split('+').forEach((amount,i) => items.push(item(`其他${i}`,'purchase',amount)));
    if (commission) items.push(item('提成','commission',String(commission)));
    const checks = day === 11 ? [{ amount: '1014.6', itemIds: ['其他0','其他1'], source: '补货868.6➕耗材146.08🟰1014.6' }] : [];
    return record(day,items,checks);
  });
  const result = run(records);
  assert.deepEqual(result.totals,{days:25,incomeCents:8079800,expenseCents:2472478,profitCents:5607322});
  assert.equal(result.dailyRows.flatMap(r=>r.details).filter(i=>i.category==='commission').reduce((n,i)=>n+i.amountCents,0),23000);
  assert.ok(result.warnings.some(w=>w.code==='TOTAL_MISMATCH' && w.severity==='info' && w.message.includes('0.08')));
  assert.ok(result.warnings.some(w=>w.code==='BLANK_AS_ZERO' && w.severity==='info'));
});
test('十进制转换和非法数字',()=>{ assert.equal(cents('146.08'),14608); assert.equal(cents('-0.01'),-1); for(const v of ['1.001','NaN','1e3','',12]) assert.throws(()=>cents(v)); });
test('同日合并、完全重复去重、负利润',()=>{ const a=record(1,[item('收入','income','10')]); const b=record(1,[item('进货','purchase','20')]); const r=run([a,a,b]); assert.equal(r.totals.profitCents,-1000); assert.equal(r.totals.days,1); assert.ok(r.warnings.some(w=>w.code==='DUPLICATE')); });
test('红包作为实际总提成，包含说明不会重复计入',()=>{ const source='红包100元（已包含提成20元）'; const a=item('红包','redPacket','100',{source}); const b=item('提成','commission','20',{source,includedIn:'红包',inclusionSource:source}); assert.equal(run([record(1,[a,b])]).totals.expenseCents,10000); assert.equal(run([record(1,[a,{...b,includedIn:null,inclusionSource:null}])]).totals.expenseCents,10000); });
test('有效收入行金额冲突标为review，继续按单价数量计算并保留原文', () => {
  const source = '368　2束100元';
  const sale = item('花束', 'income', '100', { unitPrice: '368', quantity: 2, quantityUnit: '束', source });
  const result = run([record(3, [sale])]);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.totals, { days: 1, incomeCents: 73600, expenseCents: 0, profitCents: 73600 });
  assert.equal(result.dailyRows[0].details[0].source, source);
  assert.equal(result.dailyRows[0].details[0].included, false);
  const warning = result.warnings.find(entry => entry.code === 'ITEM_MISMATCH');
  assert.equal(warning.severity, 'review');
  assert.equal(warning.date, '10月3日');
  assert.match(warning.message, /736\.00/);
  assert.match(warning.message, /100\.00/);
});
test('支出行冲突仅在实际入账时要求review，明确包含后降为info且不重复入账', () => {
  const suppliesSource = '耗材：单价10元，2卷，行金额15元';
  const source = `采购100元已包含${suppliesSource}`;
  const purchase = item('采购', 'purchase', '100', { source });
  const supplies = item('耗材', 'supplies', '15', { unitPrice: '10', quantity: 2, quantityUnit: '卷', source: suppliesSource });
  const counted = run([record(1, [supplies])]);
  assert.equal(counted.totals.expenseCents, 2000);
  assert.equal(counted.warnings.find(warning => warning.code === 'ITEM_MISMATCH').severity, 'review');
  const included = run([record(1, [purchase, { ...supplies, includedIn: purchase.id, inclusionSource: source }])]);
  assert.deepEqual(included.totals, { days: 1, incomeCents: 0, expenseCents: 10000, profitCents: -10000 });
  assert.equal(included.dailyRows[0].details.find(detail => detail.category === 'supplies').included, true);
  assert.equal(included.warnings.find(warning => warning.code === 'ITEM_MISMATCH').severity, 'info');
  assert.equal(included.warnings.find(warning => warning.code === 'INCLUDED').severity, 'info');
});
test('漏字段、虚构来源、无记录、跨月和非法日期失败',()=>{ const a=record(1,[item('收入','income','10')]); const missing=structuredClone(a); delete missing.items[0].amount; assert.throws(()=>run([missing])); assert.throws(()=>calculateLedger({records:[a]},'不相干文字')); assert.throws(()=>run([])); assert.throws(()=>run([a,{...a,month:11}])); assert.throws(()=>run([{...a,month:2,day:30}])); });
test('非法包含关系、汇总引用、数量来源缺失失败',()=>{ for(const extra of [{includedIn:'不存在',inclusionSource:'已包含'}, {quantity:2}]) assert.throws(()=>run([record(1,[item('收入','income','10',extra)])])); assert.throws(()=>run([record(1,[item('收入','income','10')],[{amount:'10',itemIds:['不存在'],source:'合计10'}])])); });
test('真实模型抽取快照：来源与整月金额回归',async()=>{ const {readFile}=await import('node:fs/promises');const text=await readFile(new URL('./fixtures/october.txt',import.meta.url),'utf8');const extraction=JSON.parse(await readFile(new URL('./fixtures/october.extracted.json',import.meta.url),'utf8'));const result=calculateLedger(extraction,text);assert.deepEqual(result.totals,{days:25,incomeCents:8079800,expenseCents:2472478,profitCents:5607322}); });
test('原文不存在的金额拒绝入账',()=>{const r=record(1,[item('收入','income','999',{source:'收入100元'})]);assert.throws(()=>run([r]));});
test('聊天空格不影响来源校验，但不可合并数字',()=>{const a=record(1,[item('收入','income','10',{source:'收入10元'})]);const text=a.source.replace('收入10元','收入\u00a0 10\u00a0元');assert.equal(calculateLedger({records:[a]},text).totals.incomeCents,1000);assert.throws(()=>calculateLedger({records:[a]},a.source.replace('10元','1 0元')));});
test('整月收入价格档和五类支出与总额一致', async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('./fixtures/october.txt', import.meta.url), 'utf8');
  const extraction = JSON.parse(await readFile(new URL('./fixtures/october.extracted.json', import.meta.url), 'utf8'));
  const result = calculateLedger(extraction, text);
  assert.deepEqual(result.breakdown.incomeByPrice.slice(0, 3), [
    { unitPriceCents: 36800, quantity: 190, quantityUnit: '束', amountCents: 6992000 },
    { unitPriceCents: 28800, quantity: 30, quantityUnit: '束', amountCents: 864000 },
    { unitPriceCents: 30000, quantity: 2, quantityUnit: '束', amountCents: 60000 },
  ]);
  assert.equal(result.breakdown.incomeByPrice.reduce((total, group) => total + group.quantity, 0), 231);
  assert.equal(result.breakdown.incomeByPrice.reduce((total, group) => total + group.amountCents, 0), result.totals.incomeCents);
  assert.equal(result.breakdown.unclassifiedIncomeCents, 0);
  assert.deepEqual(result.breakdown.expenses, [
    { category: 'redPacket', amountCents: 1066000 },
    { category: 'purchase', amountCents: 1377370 },
    { category: 'commission', amountCents: 0 },
    { category: 'supplies', amountCents: 29108 },
    { category: 'other', amountCents: 0 },
  ]);
  assert.equal(result.breakdown.expenses.reduce((total, entry) => total + entry.amountCents, 0), result.totals.expenseCents);
  assert.equal(result.dailyRows[0].details[0].unitPriceCents, 36800);
  assert.equal(result.dailyRows[0].details[0].quantity, 11);
  assert.equal(result.dailyRows[0].details[0].quantityUnit, '束');
});
test('未知数量、只有合计保留金额；未知单位不猜成束', () => {
  const result = run([record(1, [
    item('已知单价', 'income', '500', { unitPrice: '100', source: '单价100元，收入500元' }),
    item('只有合计', 'income', '200'),
    item('未知单位', 'income', '20', { unitPrice: '10', quantity: 2, source: '单价10，数量2，共20元' }),
    item('已知数量', 'income', '30', { quantity: 3, quantityUnit: '个', source: '3个共30元' }),
  ])]);
  assert.equal(result.breakdown.unclassifiedIncomeCents, 73000);
  assert.deepEqual(result.breakdown.incomeByPrice, [{ unitPriceCents: 1000, quantity: 2, quantityUnit: null, amountCents: 2000 }]);
  assert.equal(result.totals.incomeCents, 75000);
  assert.equal(result.dailyRows[0].details[0].quantity, null);
  assert.equal(result.dailyRows[0].details[3].unitPriceCents, null);
  assert.ok(result.breakdown.expenses.every(expense => expense.amountCents === 0));
});
test('按单价及单位分组，先销量再收入排序，不将不同单位混为束', () => {
  const first = record(1, [
    item('束10', 'income', '20', { unitPrice: '10', quantity: 2, quantityUnit: '束', source: '10元2束20元' }),
    item('盒10', 'income', '20', { unitPrice: '10', quantity: 2, quantityUnit: '盒', source: '10元2盒20元' }),
    item('束20', 'income', '40', { unitPrice: '20', quantity: 2, quantityUnit: '束', source: '20元2束40元' }),
  ]);
  const second = record(2, [item('束10', 'income', '10', { unitPrice: '10', quantity: 1, quantityUnit: '束', source: '10元1束10元' })]);
  const result = run([first, first, second]);
  assert.deepEqual(result.breakdown.incomeByPrice, [
    { unitPriceCents: 1000, quantityUnit: '束', quantity: 3, amountCents: 3000 },
    { unitPriceCents: 2000, quantityUnit: '束', quantity: 2, amountCents: 4000 },
    { unitPriceCents: 1000, quantityUnit: '盒', quantity: 2, amountCents: 2000 },
  ]);
  assert.equal(result.totals.incomeCents, 9000);
});
test('已包含的提成不重复进入支出分类，负利润口径不变', () => {
  const source = '红包100元（已包含提成20元）';
  const result = run([record(1, [
    item('收入', 'income', '50'),
    item('红包', 'redPacket', '100', { source }),
    item('提成', 'commission', '20', { source, includedIn: '红包', inclusionSource: source }),
  ])]);
  assert.equal(result.breakdown.expenses.find(entry => entry.category === 'redPacket').amountCents, 10000);
  assert.equal(result.breakdown.expenses.find(entry => entry.category === 'commission').amountCents, 0);
  assert.equal(result.totals.profitCents, -5000);
});
test('数量必须来自原文的数量位置，单位缺失或虚构拒绝通过', () => {
  for (const extra of [
    { quantity: 9, quantityUnit: '束' },
    { quantity: 368, quantityUnit: '束' },
    { quantity: 2, quantityUnit: '盒' },
    { quantity: 2, quantityUnit: '' },
  ]) {
    assert.throws(() => run([record(1, [item('花束', 'income', '736', { unitPrice: '368', source: '368元2束736元', ...extra })])]));
  }
  const missingUnit = item('花束', 'income', '736', { unitPrice: '368', quantity: 2, source: '368元2束736元' });
  delete missingUnit.quantityUnit;
  assert.throws(() => run([record(1, [missingUnit])]));
});
test('仅写单价和数量的简写由代码计算，模型不得补造行金额', () => {
  const sale = item('花束', 'income', null, { unitPrice: '368', quantity: 11, quantityUnit: '束', source: '368元 11束' });
  const result = run([record(1, [sale])]);
  assert.deepEqual(result.totals, { days: 1, incomeCents: 404800, expenseCents: 0, profitCents: 404800 });
  assert.deepEqual(result.breakdown.incomeByPrice, [{ unitPriceCents: 36800, quantity: 11, quantityUnit: '束', amountCents: 404800 }]);
  assert.equal(result.dailyRows[0].details[0].amountCents, 404800);
  assert.equal(result.dailyRows[0].details[0].quantityUnit, '束');
  assert.equal(result.breakdown.unclassifiedIncomeCents, 0);
  assert.ok(!result.warnings.some(warning => warning.code === 'BLANK_AS_ZERO'));
  assert.throws(() => run([record(1, [{ ...sale, amount: '4048' }])]));
});
test('明确写出的金额不能被模型以null当作留白或全零成功', () => {
  for (const sale of [
    item('收入', 'income', null, { source: '收入100元' }),
    item('收入', 'income', null, { unitPrice: '100', source: '单价100元，收入100元' }),
    item('花束', 'income', null, { unitPrice: '368', quantity: 2, quantityUnit: '束', source: '368元2束736元' }),
    item('进货', 'purchase', null, { source: '进货1,014.68元' }),
  ]) {
    assert.throws(() => run([record(1, [sale])]), error => error.code === 'INVALID_EXTRACTION');
  }
});
test('真正留白模板和原文明示零金额保持有效，不反推缺失单价或数量', () => {
  const result = run([record(1, [
    item('进花', 'purchase', null, { source: '进花' }),
    item('空价格档', 'income', null, { quantityUnit: '束', source: '288 束 元' }),
    item('已知单价空档', 'income', null, { unitPrice: '368', quantityUnit: '束', source: '368 束 元' }),
    item('其他', 'other', '0', { source: '其他费用0元' }),
  ])]);
  assert.deepEqual(result.totals, { days: 1, incomeCents: 0, expenseCents: 0, profitCents: 0 });
  assert.equal(result.dailyRows[0].details[1].unitPriceCents, null);
  assert.equal(result.dailyRows[0].details[1].quantity, null);
  assert.ok(result.warnings.some(warning => warning.code === 'BLANK_AS_ZERO'));
});
test('否定、另计和不确定的包含关系拒绝排除费用', () => {
  for (const source of [
    '红包100元（不包含提成20元）', '红包100元（不含提成20元）',
    '红包100元（未含提成20元）', '红包100元（未计入提成20元）',
    '红包100元已包含提成20元，提成另计', '红包100元已含提成20元，另行支付',
    '红包100元是否包含提成20元？', '店内红包100元，提成20元',
  ]) {
    const items = [item('红包', 'redPacket', '100', { source }), item('提成', 'commission', '20', { source, includedIn: '红包', inclusionSource: source })];
    assert.throws(() => run([record(1, items)]), error => error.code === 'INVALID_EXTRACTION');
  }
});
test('截掉否定前缀的包含依据仍按完整原文拒绝', () => {
  for (const [source, inclusionSource] of [
    ['红包100元（不包含提成20元）', '包含提成20元'],
    ['红包100元（不 含提成20元）', '含提成20元'],
    ['红包100元（未曾包括提成20元）', '包括提成20元'],
    ['红包100元可能已包含提成20元', '已包含提成20元'],
  ]) {
    assert.throws(() => run([record(1, [
      item('红包', 'redPacket', '100', { source }),
      item('提成', 'commission', '20', { source, includedIn: '红包', inclusionSource }),
    ])]), error => error.code === 'INVALID_EXTRACTION');
  }
});
