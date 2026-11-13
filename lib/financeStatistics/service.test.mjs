import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './testLoader.mjs';
const ledger = loadModule('ledger.ts');
const provider = loadModule('provider.ts', {'./ledger':ledger});
const limits = loadModule('limits.ts', {'./ledger':ledger});
test('限流同步预占、释放幂等、每日重置',()=>{
  delete global.financeLimits;
  const now = Date.UTC(2026,9,1);
  const a=limits.reserveCall('a',now), b=limits.reserveCall('b',now);
  assert.throws(()=>limits.reserveCall('c',now),e=>e.httpStatus===429);
  a();a();b();
  for(let i=0;i<2;i++) limits.reserveCall('a',now)();
  assert.throws(()=>limits.reserveCall('a',now),e=>e.httpStatus===429);
  limits.reserveCall('a',now+86400000)();
});
test('模型只接受completed且可解析的输出',async()=>{
  const originalFetch=global.fetch, originalKey=process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY='test-only';
  try {
    for(const body of [{status:'incomplete',output:[]},{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'bad json'}]}]}]) {
      global.fetch=async()=>({ok:true,json:async()=>body});
      await assert.rejects(()=>provider.extractLedger('测试',new AbortController().signal));
    }
    global.fetch=async()=>({ok:false});
    await assert.rejects(()=>provider.extractLedger('测试',new AbortController().signal),e=>e.httpStatus===502);
    global.fetch=async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"records":[]}'}]}]})});
    assert.deepEqual(await provider.extractLedger('测试',new AbortController().signal),{records:[]});
  } finally {global.fetch=originalFetch;if(originalKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=originalKey;}
});
test('接口输入错误、无配置、超时均不伪造成功',async()=>{
  let released=0;
  const route=loadModule('../../app/api/finance-statistics/route.ts',{
    '@/lib/financeStatistics/ledger':ledger,
    '@/lib/financeStatistics/provider':{extractLedger:async()=>{throw new ledger.FinanceError('PROVIDER_ERROR','不可用',502);}},
    '@/lib/financeStatistics/limits':{reserveCall:()=>()=>released++},
  });
  const request=text=>new Request('http://localhost/api/finance-statistics',{method:'POST',body:JSON.stringify({text})});
  const key=process.env.DEEPSEEK_API_KEY;
  try {
    assert.equal((await route.POST(request(''))).status,400);
    assert.equal((await route.POST(request('a'.repeat(20001)))).status,413);
    delete process.env.DEEPSEEK_API_KEY;
    assert.equal((await route.POST(request('账目'))).status,503);
    process.env.DEEPSEEK_API_KEY='test-only';
    const failed=await route.POST(request('账目'));
    assert.equal(failed.status,502);assert.equal((await failed.json()).status,'failed');assert.equal(released,1);
    const controller=new AbortController();controller.abort();
    const timeout=await route.POST(new Request('http://localhost',{method:'POST',body:JSON.stringify({text:'账目'}),signal:controller.signal}));
    assert.equal(timeout.status,504);
  } finally {if(key===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=key;}
});
test('成功接口保留总额分类并显式透传review及info提示级别', async () => {
  let providerCalls = 0;
  let released = false;
  const source = '10月1日\n单价288元，2束500元\n红包20元';
  const extraction = { records: [{ year: null, month: 10, day: 1, source, checks: [], items: [
    { id: 'sale', category: 'income', label: '花束', amount: '500', unitPrice: '288', quantity: 2, quantityUnit: '束', source: '单价288元，2束500元', includedIn: null, inclusionSource: null, commissionFor: null },
    { id: 'expense', category: 'redPacket', label: '红包', amount: '20', unitPrice: null, quantity: null, quantityUnit: null, source: '红包20元', includedIn: null, inclusionSource: null, commissionFor: null },
  ] }] };
  const route = loadModule('../../app/api/finance-statistics/route.ts', {
    '@/lib/financeStatistics/ledger': ledger,
    '@/lib/financeStatistics/provider': { extractLedger: async text => { assert.equal(text, source); providerCalls++; return extraction; } },
    '@/lib/financeStatistics/limits': { reserveCall: () => () => { released = true; } },
  });
  const key = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-only';
  try {
    const response = await route.POST(new Request('http://localhost/api/finance-statistics', { method: 'POST', body: JSON.stringify({ text: source }) }));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.totals, { days: 1, incomeCents: 57600, expenseCents: 2000, profitCents: 55600 });
    assert.deepEqual(result.breakdown.incomeByPrice, [{ unitPriceCents: 28800, quantity: 2, quantityUnit: '束', amountCents: 57600 }]);
    assert.equal(result.dailyRows[0].details[0].quantityUnit, '束');
    assert.equal(result.dailyRows[0].details[0].accountingNote, null);
    assert.equal(result.dailyRows[0].commissionCheck.status, 'mismatch');
    assert.equal(result.breakdown.expenses[0].amountCents, 2000);
    assert.deepEqual(result.warnings.map(({ code, severity }) => ({ code, severity })), [
      { code: 'ITEM_MISMATCH', severity: 'review' },
      { code: 'COMMISSION_MISMATCH', severity: 'info' },
    ]);
    assert.equal(providerCalls, 1);
    assert.equal(released, true);
  } finally { if (key === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = key; }
});
test('缺红包且特殊花束未注明提成，接口保留收入并返回待核对结果', async () => {
  let providerCalls = 0;
  let released = false;
  const source = '10月1日\n168元 1束168元';
  const extraction = { records: [{ year: null, month: 10, day: 1, source, checks: [], items: [
    { id: 'sale', category: 'income', label: '特殊花束', amount: '168', unitPrice: '168', quantity: 1, quantityUnit: '束', source: '168元 1束168元', includedIn: null, inclusionSource: null, commissionFor: null },
  ] }] };
  const route = loadModule('../../app/api/finance-statistics/route.ts', {
    '@/lib/financeStatistics/ledger': ledger,
    '@/lib/financeStatistics/provider': { extractLedger: async () => { providerCalls++; return extraction; } },
    '@/lib/financeStatistics/limits': { reserveCall: () => () => { released = true; } },
  });
  const key = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-only';
  try {
    const response = await route.POST(new Request('http://localhost/api/finance-statistics', { method: 'POST', body: JSON.stringify({ text: source }) }));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.status, 'completed');
    assert.equal(result.schemaVersion, 1);
    assert.deepEqual(result.totals, { days: 1, incomeCents: 16800, expenseCents: 0, profitCents: 16800 });
    assert.equal(result.dailyRows[0].commissionCheck.status, 'incomplete');
    const warning = result.warnings.find(item => item.code === 'COMMISSION_INCOMPLETE');
    assert.equal(warning.date, '10月1日');
    assert.equal(warning.severity, 'review');
    assert.match(warning.message, /168/);
    assert.equal(providerCalls, 1);
    assert.equal(released, true);
  } finally { if (key === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = key; }
});
