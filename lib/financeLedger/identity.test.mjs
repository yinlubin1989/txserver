import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, input } from './testSupport.mjs';
import { loadModule } from '../financeStatistics/testLoader.mjs';
const { wechatAccount } = loadModule('../financeLedger/wechatIdentity.ts');
const { hashToken } = loadModule('../financeLedger/service.ts');
const accountA = 'a'.repeat(64), accountB = 'b'.repeat(64);
const login = (service, account = accountA, legacy = null) => service.createWechatSession({ code: 'one-use-code' }, legacy, async () => account);

test('same verified WeChat account recovers bills with a new token after clearing all client storage', async () => {
  const { service } = setup();
  const first = await login(service);
  const saved = await service.saveBill(first.token, input());
  const restarted = await login(service);
  assert.notEqual(first.token, restarted.token);
  assert.equal(restarted.identity, 'wechat');
  assert.equal((await service.listBills(restarted.token, null)).bills[0].id, saved.bill.id);
  assert.deepEqual(await service.getBill(restarted.token, saved.bill.id), saved.bill);
  const other = await login(service, accountB);
  assert.equal((await service.listBills(other.token, null)).bills.length, 0);
  await assert.rejects(service.getBill(other.token, saved.bill.id), { code: 'BILL_NOT_FOUND' });
});

test('legacy binding preserves private/public state, snapshot, id, share and idempotency', async () => {
  const { service } = setup();
  const legacy = await service.createSession();
  const saved = await service.saveBill(legacy.token, input());
  const share = await service.shareBill(legacy.token, saved.bill.id);
  const account = await login(service, accountA, legacy.token);
  assert.equal((await service.saveBill(account.token, input())).bill.id, saved.bill.id);
  assert.equal((await service.getBill(account.token, saved.bill.id)).visibility, 'public');
  assert.deepEqual((await service.getSharedBill(share.token)).report, saved.bill.report);
  const again = await login(service, accountA, legacy.token);
  assert.equal((await service.listBills(again.token, null)).bills.length, 1);
  await service.setVisibility(again.token, saved.bill.id, { visibility: 'private' });
  await assert.rejects(service.getSharedBill(share.token), { code: 'BILL_NOT_FOUND' });
  await service.deleteBill(again.token, saved.bill.id);
  assert.equal((await service.listBills(account.token, null)).bills.length, 0);
  await assert.rejects(service.saveBill(account.token, input()), { code: 'BILL_DELETED' });
});

test('legacy credentials cannot gain access to new account bills or bind to two accounts', async () => {
  const { service } = setup();
  const legacy = await service.createSession();
  const account = await login(service, accountA, legacy.token);
  const saved = await service.saveBill(account.token, input());
  await assert.rejects(service.getBill(legacy.token, saved.bill.id), { code: 'BILL_NOT_FOUND' });
  await assert.rejects(login(service, accountB, legacy.token), { code: 'LEGACY_SESSION_CONFLICT' });
  await assert.rejects(login(service, accountB, account.token), { code: 'LEGACY_SESSION_CONFLICT' });
  await assert.rejects(login(service, accountA, 'f'.repeat(64)), { code: 'LEGACY_SESSION_CONFLICT' });
});

test('concurrent binding admits only one account; lost unbound credentials cannot be guessed back', async () => {
  const { service } = setup();
  const legacy = await service.createSession();
  await service.saveBill(legacy.token, input());
  const unbound = await login(service);
  assert.equal((await service.listBills(unbound.token, null)).bills.length, 0);
  const races = await Promise.allSettled([login(service, accountA, legacy.token), login(service, accountB, legacy.token)]);
  assert.equal(races.filter(r => r.status === 'fulfilled').length, 1);
});

test('expired token is rejected while another verified login recovers account', async () => {
  const { storage, service } = setup();
  const first = await login(service);
  const saved = await service.saveBill(first.token, input());
  storage.sessions.get(hashToken(first.token)).expiresAt = '2000-01-01T00:00:00.000Z';
  await assert.rejects(service.listBills(first.token, null), { code: 'UNAUTHORIZED' });
  const next = await login(service);
  assert.equal((await service.listBills(next.token, null)).bills[0].id, saved.bill.id);
});

test('invalid requests and failed identity checks do not bind or create credentials', async () => {
  const { service, storage } = setup();
  for (const raw of [{}, { code: '' }, { code: 'abc', openid: 'forged' }, { code: ['abc'] }]) {
    await assert.rejects(service.createWechatSession(raw, null, async () => accountA), { code: 'INVALID_LOGIN' });
  }
  const legacy = await service.createSession();
  await assert.rejects(service.createWechatSession({ code: 'code' }, legacy.token, async () => { throw new Error('offline'); }), /offline/);
  assert.equal(storage.sessions.size, 1);
  assert.equal(storage.sessions.get(hashToken(legacy.token)).claimedBy, undefined);
});

const env = { WECHAT_APP_ID: 'wx-test', WECHAT_APP_SECRET: 'server-only-test' };
const response = body => async () => ({ ok: true, json: async () => body });
test('code2Session validates success and scopes stable identity by AppID', async () => {
  const fetcher = async (url, options) => {
    assert.equal(url.origin, 'https://api.weixin.qq.com');
    assert.equal(url.searchParams.get('js_code'), 'code');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    return { ok: true, json: async () => ({ openid: 'wx-user', session_key: 'private-key' }) };
  };
  const first = await wechatAccount('code', fetcher, env);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, await wechatAccount('code', fetcher, env));
  assert.notEqual(first, await wechatAccount('code', fetcher, { ...env, WECHAT_APP_ID: 'other-app' }));
  assert.equal(first, await wechatAccount('code', response({ errcode: 0, openid: 'wx-user', session_key: 'private-key' }), env));
});

test('upstream failures and missing config never masquerade as a new anonymous ledger or leak secrets', async () => {
  for (const data of [{}, { openid: 'wx-user' }, { errcode: '0', openid: 'wx-user', session_key: 'key' }, { errcode: -1, openid: 'wx-user', session_key: 'key' }]) {
    await assert.rejects(wechatAccount('code', response(data), env), { code: 'WECHAT_LOGIN_UNAVAILABLE' });
  }
  await assert.rejects(wechatAccount('code', response({ errcode: 40029 }), env), { code: 'WECHAT_CODE_INVALID' });
  await assert.rejects(wechatAccount('code', response({}), {}), { code: 'WECHAT_NOT_CONFIGURED' });
  await assert.rejects(wechatAccount('code', async () => { throw new Error('secret-url'); }, env), error => {
    assert.equal(error.code, 'WECHAT_LOGIN_UNAVAILABLE'); assert.ok(!error.message.includes('secret-url')); return true;
  });
});

test('combined legacy ledgers paginate without duplication and cannot be mutated by another account', async () => {
  const { service } = setup();
  const legacyA = await service.createSession(), legacyB = await service.createSession();
  for (let i = 0; i < 23; i++) await service.saveBill(i % 2 ? legacyA.token : legacyB.token, input(`combined_${i}`));
  await login(service, accountA, legacyA.token);
  const account = await login(service, accountA, legacyB.token);
  const first = await service.listBills(account.token, null);
  const last = await service.listBills(account.token, first.nextCursor);
  assert.equal(first.bills.length, 20); assert.equal(last.bills.length, 3);
  assert.equal(new Set([...first.bills, ...last.bills].map(bill => bill.id)).size, 23);
  const other = await login(service, accountB);
  const id = first.bills[0].id;
  await assert.rejects(service.shareBill(other.token, id), { code: 'BILL_NOT_FOUND' });
  await assert.rejects(service.setVisibility(other.token, id, { visibility: 'public' }), { code: 'BILL_NOT_FOUND' });
  await assert.rejects(service.deleteBill(other.token, id), { code: 'BILL_NOT_FOUND' });
});

test('WeChat session route returns explicit identity, honors legacy Bearer and rejects forged client identity', async () => {
  const { storage } = setup();
  const http = loadModule('../financeLedger/http.ts', {
    './storage': { mongoLedgerStorage: storage }, './limits': { limitRequest() {} },
    './wechatIdentity': { wechatAccount: async () => accountA },
  });
  const legacy = await http.ledgerService.createSession();
  const route = loadModule('../../app/api/finance-ledger/wechat-session/route.ts', { '@/lib/financeLedger/http': http });
  const response = await route.POST(new Request('https://example.test/api/finance-ledger/wechat-session', {
    method: 'POST', headers: { Authorization: `Bearer ${legacy.token}` }, body: JSON.stringify({ code: 'code' }),
  }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.status, 'completed'); assert.equal(body.schemaVersion, 1);
  assert.equal(body.session.identity, 'wechat'); assert.match(body.session.token, /^[a-f0-9]{64}$/);
  assert.equal(storage.sessions.get(hashToken(legacy.token)).claimedBy, accountA);
  const forged = await route.POST(new Request('https://example.test', {
    method: 'POST', body: JSON.stringify({ code: 'code', openid: 'forged-user' }),
  }));
  assert.equal(forged.status, 400); assert.equal((await forged.json()).code, 'INVALID_LOGIN');
});
