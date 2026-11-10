import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadModule } from '../financeStatistics/testLoader.mjs';

const { hashToken } = loadModule('../financeLedger/service.ts');
const { validateReport, decodeCursor } = loadModule('../financeLedger/validation.ts');
const { calculateLedger } = loadModule('ledger.ts');

import { report, input, setup } from './testSupport.mjs';

test('真实整月统计快照可保存，保留分币、收入构成和核对等级', async () => {
  const text = await readFile(new URL('../financeStatistics/fixtures/october.txt', import.meta.url), 'utf8');
  const extracted = JSON.parse(await readFile(new URL('../financeStatistics/fixtures/october.extracted.json', import.meta.url), 'utf8'));
  const result = calculateLedger(extracted, text);
  assert.equal(validateReport(result), result);
  const { service } = setup(); const { token } = await service.createSession();
  const saved = await service.saveBill(token, { report: result, text, clientRequestId: 'october_fixture' });
  assert.deepEqual(saved.bill.report.totals, { days: 25, incomeCents: 8079800, expenseCents: 2472478, profitCents: 5607322 });
  assert.deepEqual((await service.getBill(token, saved.bill.id)).report, result);
});

test('凭证仅存hash，每个设备只能列出和获取自己的账单', async () => {
  const { storage, service } = setup();
  const a = await service.createSession(); const b = await service.createSession();
  assert.match(a.token, /^[a-f0-9]{64}$/); assert.notEqual(a.token, b.token);
  assert.ok(storage.sessions.has(hashToken(a.token))); assert.ok(!storage.sessions.has(a.token));
  const saved = await service.saveBill(a.token, input());
  assert.deepEqual(Object.keys(saved.bill).sort(), ['createdAt', 'id', 'report', 'text', 'visibility']);
  assert.equal((await service.listBills(a.token, null)).bills.length, 1);
  assert.equal((await service.listBills(b.token, null)).bills.length, 0);
  await assert.rejects(service.getBill(b.token, saved.bill.id), { code: 'BILL_NOT_FOUND' });
  await assert.rejects(service.shareBill(b.token, saved.bill.id), { code: 'BILL_NOT_FOUND' });
  await assert.rejects(service.listBills(null, null), { code: 'UNAUTHORIZED' });
  await assert.rejects(service.listBills('f'.repeat(64), null), { code: 'UNAUTHORIZED' });
});

test('并发重复保存只有一条，不同内容复用标识明确冲突', async () => {
  const { storage, service } = setup(); const { token } = await service.createSession();
  const [first, second] = await Promise.all([service.saveBill(token, input()), service.saveBill(token, input())]);
  assert.equal(first.bill.id, second.bill.id); assert.equal(storage.bills.size, 1);
  assert.deepEqual([first.created, second.created].sort(), [false, true]);
  const reordered = input(); reordered.report.period = { month: 10, year: null };
  assert.equal((await service.saveBill(token, reordered)).bill.id, first.bill.id);
  await assert.rejects(service.saveBill(token, { ...input(), text: '另一份原文' }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(storage.bills.size, 1);
});

test('分享复用独立能力token，接收者得到完整结果而不是原文和其他账本', async () => {
  const { service } = setup(); const { token } = await service.createSession();
  const saved = await service.saveBill(token, input());
  const share = await service.shareBill(token, saved.bill.id);
  assert.match(share.token, /^[a-f0-9]{64}$/); assert.notEqual(share.token, token);
  assert.deepEqual(await service.shareBill(token, saved.bill.id), share);
  const shared = await service.getSharedBill(share.token);
  assert.deepEqual(shared.report, saved.bill.report);
  assert.deepEqual(Object.keys(shared).sort(), ['createdAt', 'id', 'report']);
  assert.ok(!JSON.stringify(shared).includes('原始聊天全文'));
  await assert.rejects(service.getSharedBill(token), { code: 'BILL_NOT_FOUND' });
  await assert.rejects(service.getBill(share.token, saved.bill.id), { code: 'UNAUTHORIZED' });
  await assert.rejects(service.getSharedBill('unknown'), { code: 'BILL_NOT_FOUND' });
});

test('保存失败不产生账单或可分享空壳', async () => {
  const { storage, service } = setup(); const { token } = await service.createSession();
  storage.insertBill = async () => { throw new Error('storage unavailable'); };
  await assert.rejects(service.saveBill(token, input()), /storage unavailable/);
  assert.equal(storage.bills.size, 0);
  await assert.rejects(service.shareBill(token, 'a'.repeat(24)), { code: 'BILL_NOT_FOUND' });
});

test('分页在同毫秒保存时仍不重不漏，游标不能绕过owner', async () => {
  const { service } = setup(); const a = await service.createSession(); const b = await service.createSession();
  for (let i = 0; i < 23; i++) await service.saveBill(a.token, input(`bill_request_${String(i).padStart(4, '0')}`));
  await service.saveBill(b.token, input());
  const first = await service.listBills(a.token, null); const second = await service.listBills(a.token, first.nextCursor);
  assert.equal(first.bills.length, 20); assert.equal(second.bills.length, 3); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.bills, ...second.bills].map(bill => bill.id)).size, 23);
  assert.ok(first.bills.every(bill => bill.reviewCount === 0 && !Object.hasOwn(bill, 'report') && !Object.hasOwn(bill, 'text')));
  assert.ok((await service.listBills(b.token, first.nextCursor)).bills.length <= 1);
  assert.throws(() => decodeCursor('not:a:cursor'), { code: 'INVALID_CURSOR' });
});

test('非法状态、漏字段、分币误差、溢出、重复日期和分类冲突拒绝保存', () => {
  const mutate = callback => { const value = report(); callback(value); assert.throws(() => validateReport(value), { code: 'INVALID_BILL' }); };
  mutate(value => { value.status = 'failed'; });
  mutate(value => { delete value.dailyRows[0].details[0].quantityUnit; });
  mutate(value => { value.dailyRows[0].incomeCents += 0.01; });
  mutate(value => { value.dailyRows[0].details[0].unitPriceCents = Number.MAX_SAFE_INTEGER; value.dailyRows[0].details[0].quantity = 2; });
  mutate(value => { value.dailyRows.push(structuredClone(value.dailyRows[0])); });
  mutate(value => { value.totals.days = 2; });
  mutate(value => { value.totals.profitCents = 0; });
  mutate(value => { value.dailyRows[0].details[2].included = false; });
  mutate(value => { value.breakdown.expenses[3].amountCents = 1000; });
  mutate(value => { value.breakdown.incomeByPrice[0].quantity = 2; });
  mutate(value => { value.warnings[0].severity = 'critical'; });
  mutate(value => { value.dailyRows[0].commissionCheck = { status: ['matched'], message: '不能把数组强制转换为状态' }; });
});

test('未知单位、只有总额、负金额和零支出按原始契约保留', () => {
  const value = report();
  value.dailyRows[0].details = [{ ...value.dailyRows[0].details[0], unitPriceCents: null, quantity: null, quantityUnit: null, amountCents: -1234 }];
  Object.assign(value.dailyRows[0], { incomeCents: -1234, expenseCents: 0, profitCents: -1234 });
  Object.assign(value.totals, { incomeCents: -1234, expenseCents: 0, profitCents: -1234 });
  value.breakdown.incomeByPrice = []; value.breakdown.unclassifiedIncomeCents = -1234;
  value.breakdown.expenses.forEach(expense => { expense.amountCents = 0; });
  assert.deepEqual(validateReport(value), value);
  const refund = report();
  refund.dailyRows[0].details[1].amountCents = -15000;
  Object.assign(refund.dailyRows[0], { expenseCents: -15000, profitCents: 25000 });
  Object.assign(refund.totals, { expenseCents: -15000, profitCents: 25000 });
  refund.breakdown.expenses[1].amountCents = -15000;
  assert.deepEqual(validateReport(refund), refund);
});

test('路由契约：session、保存、分页、私有详情、分享及跨设备只读获取', async () => {
  const { storage } = setup();
  const http = loadModule('../financeLedger/http.ts', { './storage': { mongoLedgerStorage: storage }, './limits': { limitRequest() {} } });
  const overrides = { '@/lib/financeLedger/http': http };
  const sessionRoute = loadModule('../../app/api/finance-ledger/session/route.ts', overrides);
  const billsRoute = loadModule('../../app/api/finance-ledger/bills/route.ts', overrides);
  const billRoute = loadModule('../../app/api/finance-ledger/bills/[id]/route.ts', overrides);
  const shareRoute = loadModule('../../app/api/finance-ledger/bills/[id]/share/route.ts', overrides);
  const sharedRoute = loadModule('../../app/api/finance-ledger/shared/[token]/route.ts', overrides);
  const sessionResponse = await sessionRoute.POST(new Request('https://example.test/api/finance-ledger/session', { method: 'POST' }));
  assert.equal(sessionResponse.status, 201);
  const sessionBody = await sessionResponse.json(); assert.equal(sessionBody.status, 'completed');
  const headers = { authorization: `Bearer ${sessionBody.session.token}`, 'content-type': 'application/json' };
  const saveRequest = () => new Request('https://example.test/api/finance-ledger/bills', { method: 'POST', headers, body: JSON.stringify(input()) });
  const savedResponse = await billsRoute.POST(saveRequest()); assert.equal(savedResponse.status, 201);
  const savedBody = await savedResponse.json(); assert.equal(savedBody.schemaVersion, 1); assert.equal(savedBody.status, 'completed');
  const repeat = await billsRoute.POST(saveRequest()); assert.equal(repeat.status, 200); assert.equal((await repeat.json()).bill.id, savedBody.bill.id);
  const list = await billsRoute.GET(new Request('https://example.test/api/finance-ledger/bills', { headers }));
  assert.equal((await list.json()).bills.length, 1);
  const detail = await billRoute.GET(new Request('https://example.test', { headers }), { params: Promise.resolve({ id: savedBody.bill.id }) });
  assert.equal((await detail.json()).bill.text, input().text);
  const share = await shareRoute.POST(new Request('https://example.test', { method: 'POST', headers }), { params: Promise.resolve({ id: savedBody.bill.id }) });
  const shareBody = await share.json(); assert.equal(shareBody.status, 'completed');
  const shared = await sharedRoute.GET(new Request('https://example.test'), { params: Promise.resolve({ token: shareBody.share.token }) });
  const sharedBody = await shared.json(); assert.equal(sharedBody.status, 'completed'); assert.deepEqual(sharedBody.bill.report, savedBody.bill.report); assert.equal(Object.hasOwn(sharedBody.bill, 'text'), false);
});

test('HTTP响应严格completed/failed，不泄露内部错误，拒绝超大实际请求体', async () => {
  const { storage } = setup();
  const { handle, completed, readBody } = loadModule('../financeLedger/http.ts', { './storage': { mongoLedgerStorage: storage }, './limits': { limitRequest() {} } });
  const response = await handle(new Request('https://example.test/api'), 'read', async () => completed({ bills: [], nextCursor: null }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { schemaVersion: 1, status: 'completed', bills: [], nextCursor: null });
  const error = await handle(new Request('https://example.test/api'), 'read', async () => { throw new Error('sensitive database details'); });
  assert.equal(error.status, 503); assert.equal((await error.json()).status, 'failed');
  await assert.rejects(readBody(new Request('https://example.test', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) })), { code: 'BODY_TOO_LARGE' });
  await assert.rejects(readBody(new Request('https://example.test', { method: 'POST', body: '{broken' })), { code: 'INVALID_JSON' });
});

test('创建和写入限流，上海午夜重置每天额度', () => {
  const { limitRequest } = loadModule('../financeLedger/limits.ts');
  const beforeMidnight = Date.parse('2026-11-06T15:59:59.000Z');
  for (let i = 0; i < 20; i++) limitRequest('test-ip', 'session', '', beforeMidnight);
  assert.throws(() => limitRequest('test-ip', 'session', '', beforeMidnight), { code: 'RATE_LIMITED' });
  assert.doesNotThrow(() => limitRequest('test-ip', 'session', '', beforeMidnight + 1000));
  for (let i = 0; i < 30; i++) limitRequest('write-ip', 'write', 'owner', beforeMidnight);
  assert.throws(() => limitRequest('write-ip', 'write', 'owner', beforeMidnight), { code: 'RATE_LIMITED' });
});

