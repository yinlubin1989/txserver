import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from '../financeStatistics/testLoader.mjs';
import { input, setup } from './testSupport.mjs';

test('私有/公开切换严格按契约返回，旧链接撤销后不会复活', async () => {
  const { service } = setup(); const { token } = await service.createSession();
  const saved = await service.saveBill(token, input());
  assert.equal(saved.bill.visibility, 'private');
  assert.equal((await service.listBills(token, null)).bills[0].visibility, 'private');
  const first = await service.shareBill(token, saved.bill.id);
  assert.equal((await service.getBill(token, saved.bill.id)).visibility, 'public');
  assert.deepEqual(await service.setVisibility(token, saved.bill.id, { visibility: 'private' }), { id: saved.bill.id, visibility: 'private' });
  await assert.rejects(service.getSharedBill(first.token), { code: 'BILL_NOT_FOUND' });
  await service.setVisibility(token, saved.bill.id, { visibility: 'public' });
  await assert.rejects(service.getSharedBill(first.token), { code: 'BILL_NOT_FOUND' });
  const second = await service.shareBill(token, saved.bill.id);
  assert.notEqual(second.token, first.token);
  assert.deepEqual((await service.getSharedBill(second.token)).report, saved.bill.report);
  for (const raw of [null, [], {}, { visibility: true }, { visibility: 'PUBLIC' }, { visibility: 'public', ownerHash: 'forged' }]) {
    await assert.rejects(service.setVisibility(token, saved.bill.id, raw), { code: 'INVALID_VISIBILITY' });
  }
});

test('删除隔离owner，移除列表及全部访问，幂等重试不能复活账单', async () => {
  const { service } = setup(); const a = await service.createSession(); const b = await service.createSession();
  const saved = await service.saveBill(a.token, input());
  const share = await service.shareBill(a.token, saved.bill.id);
  await assert.rejects(service.deleteBill(b.token, saved.bill.id), { code: 'BILL_NOT_FOUND' });
  await assert.rejects(service.setVisibility(b.token, saved.bill.id, { visibility: 'private' }), { code: 'BILL_NOT_FOUND' });
  assert.deepEqual(await service.deleteBill(a.token, saved.bill.id), { id: saved.bill.id, deleted: true });
  assert.deepEqual(await service.deleteBill(a.token, saved.bill.id), { id: saved.bill.id, deleted: true });
  assert.equal((await service.listBills(a.token, null)).bills.length, 0);
  await assert.rejects(service.getBill(a.token, saved.bill.id), { code: 'BILL_NOT_FOUND' });
  await assert.rejects(service.getSharedBill(share.token), { code: 'BILL_NOT_FOUND' });
  await assert.rejects(service.shareBill(a.token, saved.bill.id), { code: 'BILL_NOT_FOUND' });
  await assert.rejects(service.setVisibility(a.token, saved.bill.id, { visibility: 'public' }), { code: 'BILL_NOT_FOUND' });
  await assert.rejects(service.saveBill(a.token, input()), { code: 'BILL_DELETED' });
});

test('PATCH/DELETE 路由返回明确状态，分享在撤销和删除后返回404', async () => {
  const { storage } = setup();
  const http = loadModule('../financeLedger/http.ts', { './storage': { mongoLedgerStorage: storage }, './limits': { limitRequest() {} } });
  const route = loadModule('../../app/api/finance-ledger/bills/[id]/route.ts', { '@/lib/financeLedger/http': http });
  const { token } = await http.ledgerService.createSession();
  const saved = await http.ledgerService.saveBill(token, input());
  const params = { params: Promise.resolve({ id: saved.bill.id }) };
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const patch = await route.PATCH(new Request('https://example.test', { method: 'PATCH', headers, body: JSON.stringify({ visibility: 'public' }) }), params);
  assert.deepEqual(await patch.json(), { schemaVersion: 1, status: 'completed', bill: { id: saved.bill.id, visibility: 'public' } });
  const denied = await route.DELETE(new Request('https://example.test', { method: 'DELETE' }), params);
  assert.equal(denied.status, 401);
  const deleted = await route.DELETE(new Request('https://example.test', { method: 'DELETE', headers }), params);
  assert.deepEqual(await deleted.json(), { schemaVersion: 1, status: 'completed', bill: { id: saved.bill.id, deleted: true } });
  const detail = await route.GET(new Request('https://example.test', { headers }), params);
  assert.equal(detail.status, 404);
});
