import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, input } from './testSupport.mjs';
import { loadModule } from '../financeStatistics/testLoader.mjs';

test('public list includes all owners public bills without requiring a share token; private/deleted stay hidden', async () => {
  const { service } = setup();
  const a = await service.createSession(), b = await service.createSession();
  const first = (await service.saveBill(a.token, input('public_first'))).bill;
  const second = (await service.saveBill(b.token, input('public_second'))).bill;
  const privateBill = (await service.saveBill(b.token, input('private_bill'))).bill;
  const deleted = (await service.saveBill(a.token, input('deleted_bill'))).bill;
  await service.setVisibility(a.token, first.id, { visibility: 'public' });
  await service.shareBill(b.token, second.id);
  await service.shareBill(a.token, deleted.id); await service.deleteBill(a.token, deleted.id);
  const list = await service.listPublicBills(null);
  assert.deepEqual(new Set(list.bills.map(b => b.id)), new Set([first.id, second.id]));
  for (const bill of list.bills) {
    assert.equal(bill.visibility, 'public');
    assert.deepEqual(Object.keys(bill).sort(), ['createdAt', 'id', 'period', 'reviewCount', 'totals', 'visibility']);
  }
  assert.equal(list.nextCursor, null);
  const detail = await service.getPublicBill(first.id);
  assert.deepEqual(Object.keys(detail).sort(), ['createdAt', 'id', 'report']);
  assert.deepEqual(detail.report, first.report);
  await assert.rejects(service.getPublicBill(privateBill.id), { code: 'BILL_NOT_FOUND' });
  await assert.rejects(service.getPublicBill(deleted.id), { code: 'BILL_NOT_FOUND' });
  await assert.rejects(service.getPublicBill('f'.repeat(24)), { code: 'BILL_NOT_FOUND' });
});

test('privacy and deletion immediately revoke public detail, list and share; nonowners cannot mutate', async () => {
  const { service } = setup();
  const owner = await service.createSession(), outsider = await service.createSession();
  const saved = (await service.saveBill(owner.token, input())).bill;
  const shared = await service.shareBill(owner.token, saved.id);
  await assert.rejects(service.deleteBill(outsider.token, saved.id), { code: 'BILL_NOT_FOUND' });
  await assert.rejects(service.setVisibility(outsider.token, saved.id, { visibility: 'private' }), { code: 'BILL_NOT_FOUND' });
  await assert.rejects(service.getBill(outsider.token, saved.id), { code: 'BILL_NOT_FOUND' });
  await service.setVisibility(owner.token, saved.id, { visibility: 'private' });
  assert.equal((await service.listPublicBills(null)).bills.length, 0);
  await assert.rejects(service.getPublicBill(saved.id), { code: 'BILL_NOT_FOUND' });
  await assert.rejects(service.getSharedBill(shared.token), { code: 'BILL_NOT_FOUND' });
  await service.setVisibility(owner.token, saved.id, { visibility: 'public' });
  assert.equal((await service.getPublicBill(saved.id)).id, saved.id);
  await service.deleteBill(owner.token, saved.id);
  assert.equal((await service.listPublicBills(null)).bills.length, 0);
  await assert.rejects(service.getPublicBill(saved.id), { code: 'BILL_NOT_FOUND' });
});

test('public pagination is stable across owners and validates cursors', async () => {
  const { service } = setup();
  const a = await service.createSession(), b = await service.createSession();
  for (let i=0; i<23; i++) {
    const owner = i % 2 ? a : b;
    const saved = (await service.saveBill(owner.token, input(`public_page_${i}`))).bill;
    await service.setVisibility(owner.token, saved.id, { visibility: 'public' });
  }
  const first = await service.listPublicBills(null), last = await service.listPublicBills(first.nextCursor);
  assert.equal(first.bills.length, 20); assert.equal(last.bills.length, 3); assert.equal(last.nextCursor, null);
  assert.equal(new Set([...first.bills, ...last.bills].map(b => b.id)).size, 23);
  await assert.rejects(service.listPublicBills('invalid:cursor'), { code: 'INVALID_CURSOR' });
});

test('public HTTP endpoints are no-store read-only snapshots and fail closed on private records', async () => {
  const { storage } = setup();
  const http = loadModule('../financeLedger/http.ts', { './storage': { mongoLedgerStorage: storage }, './limits': { limitRequest() {} } });
  const { token } = await http.ledgerService.createSession();
  const { bill } = await http.ledgerService.saveBill(token, input());
  const listRoute = loadModule('../../app/api/finance-ledger/public/route.ts', { '@/lib/financeLedger/http': http });
  const detailRoute = loadModule('../../app/api/finance-ledger/public/[id]/route.ts', { '@/lib/financeLedger/http': http });
  const req = new Request('https://example.test/api/finance-ledger/public');
  const context = { params: Promise.resolve({ id: bill.id }) };
  assert.equal((await detailRoute.GET(req, context)).status, 404);
  await http.ledgerService.setVisibility(token, bill.id, { visibility: 'public' });
  const response = await listRoute.GET(req);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const list = await response.json(); assert.equal(list.status, 'completed'); assert.equal(list.schemaVersion, 1);
  assert.equal(list.bills[0].id, bill.id);
  const detail = await (await detailRoute.GET(req, context)).json();
  assert.equal(detail.status, 'completed'); assert.deepEqual(Object.keys(detail.bill).sort(), ['createdAt','id','report']);
  assert.equal(listRoute.POST, undefined); assert.equal(detailRoute.PATCH, undefined); assert.equal(detailRoute.DELETE, undefined);
});
