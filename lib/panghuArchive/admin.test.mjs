import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { hash, loadModule, record, setup } from './testSupport.mjs';
const { ArchiveAdminService } = loadModule('./admin.ts');
const password = 'fake-test-password';
const passwordHash = bcrypt.hashSync(password, 4);

test('admin password creates a separate expiring capability and logout revokes it', async () => {
  const previous = process.env.PANGHU_ARCHIVE_ADMIN_PASSWORD_HASH;
  try {
    const { storage, service } = setup(); const user = await service.createSession({});
    let now = Date.parse('2026-11-10T00:00:00.000Z');
    const admin = new ArchiveAdminService(storage, () => new Date(now));
    delete process.env.PANGHU_ARCHIVE_ADMIN_PASSWORD_HASH;
    await assert.rejects(admin.login({ password }), { code: 'ARCHIVE_UNAVAILABLE' });
    process.env.PANGHU_ARCHIVE_ADMIN_PASSWORD_HASH = passwordHash;
    await assert.rejects(admin.login({ password: 'wrong' }), { code: 'UNAUTHORIZED' });
    await assert.rejects(admin.login({ password, role: 'admin' }), { code: 'INVALID_RECORD' });
    await assert.rejects(admin.login({ password: 'a'.repeat(73) }), { code: 'UNAUTHORIZED' });
    const session = await admin.login({ password });
    assert.equal(storage.adminSessions.has(session.token), false); assert.equal(storage.adminSessions.has(hash(session.token)), true);
    await admin.authenticate(session.token);
    await assert.rejects(admin.authenticate(user.token), { code: 'UNAUTHORIZED' });
    await assert.rejects(service.listRecords(session.token, null), { code: 'UNAUTHORIZED' });
    now += 12 * 3600000;
    await assert.rejects(admin.authenticate(session.token), { code: 'UNAUTHORIZED' });
    const next = await admin.login({ password }); await admin.logout(next.token);
    await assert.rejects(admin.authenticate(next.token), { code: 'UNAUTHORIZED' });
  } finally { if (previous === undefined) delete process.env.PANGHU_ARCHIVE_ADMIN_PASSWORD_HASH; else process.env.PANGHU_ARCHIVE_ADMIN_PASSWORD_HASH = previous; }
});

test('admin paging spans owners, filters exact IDs and UTC dates, and binds cursors to filters', async () => {
  const { storage, service } = setup(); const a = await service.createSession({}); const b = await service.createSession({});
  const adminToken = 'e'.repeat(64); storage.adminSessions.set(hash(adminToken), '2026-11-11T00:00:00.000Z');
  const admin = new ArchiveAdminService(storage, () => new Date('2026-11-10T00:00:00.000Z'));
  await service.saveRecords(a.token, { records: Array.from({ length: 50 }, (_, i) => record(i + 1)) });
  await service.saveRecords(b.token, { records: [record(1, { profile: 'fake-other-account', peerId: 'fake-other-peer', occurredAt: '2026-11-10T03:00:00.000Z' })] });
  const first = await admin.listRecords(adminToken, new URLSearchParams());
  const last = await admin.listRecords(adminToken, new URLSearchParams({ cursor: first.nextCursor }));
  assert.equal(first.records.length, 50); assert.equal(last.records.length, 1); assert.equal(last.nextCursor, null);
  assert.equal(new Set([...first.records, ...last.records].map(row => `${row.ownerId}:${row.id}`)).size, 51);
  assert.ok(first.records.every(row => /^[a-f0-9]{12}$/.test(row.ownerId) && !Object.hasOwn(row, 'ownerHash')));
  const filtered = await admin.listRecords(adminToken, new URLSearchParams({ profile: 'fake-other-account', peerId: 'fake-other-peer', from: '2026-11-10T03:00:00.000Z', to: '2026-11-10T03:00:00.000Z' }));
  assert.equal(filtered.records.length, 1); assert.equal(filtered.records[0].profile, 'fake-other-account');
  await assert.rejects(admin.listRecords(adminToken, new URLSearchParams({ cursor: first.nextCursor, profile: 'different' })), { code: 'INVALID_CURSOR' });
  for (const query of ['profile=', 'peerId=foo&peerId=bar', 'owner=forged', 'from=2026-11-10', 'from=2026-11-11T00%3A00%3A00.000Z&to=2026-11-10T00%3A00%3A00.000Z']) await assert.rejects(admin.listRecords(adminToken, new URLSearchParams(query)), { code: 'INVALID_QUERY' });
});

test('accounts group exact profile across owners without inferring names and include zero incoming accounts', async () => {
  const { storage, service } = setup(); const a = await service.createSession({}); const b = await service.createSession({});
  const adminToken = 'e'.repeat(64); storage.adminSessions.set(hash(adminToken), '2026-11-11T00:00:00.000Z');
  const admin = new ArchiveAdminService(storage, () => new Date('2026-11-10T00:00:00.000Z'));
  assert.deepEqual(await admin.listAccounts(adminToken, new URLSearchParams()), { accounts: [], nextCursor: null });
  await service.saveRecords(a.token, { records: [record(1, { peerName: '不能作为本人名字' }), record(2, { profile: 'outgoing-only', direction: 'outgoing', source: 'outbound', status: 'sent' })] });
  await service.saveRecords(b.token, { records: [record(3, { occurredAt: '2026-11-10T03:00:00.000Z' })] });
  let page = await admin.listAccounts(adminToken, new URLSearchParams());
  assert.equal(page.accounts.length, 2);
  assert.deepEqual(page.accounts.find(row => row.profile === record().profile), { profile: record().profile, displayName: null, incomingCount: 2, lastReceivedAt: '2026-11-10T03:00:00.000Z' });
  assert.deepEqual(page.accounts.find(row => row.profile === 'outgoing-only'), { profile: 'outgoing-only', displayName: null, incomingCount: 0, lastReceivedAt: null });
  const before = structuredClone([...storage.records]);
  assert.deepEqual(await admin.setAccountName(adminToken, { profile: record().profile, displayName: '管理员备注' }), { profile: record().profile, displayName: '管理员备注' });
  page = await admin.listAccounts(adminToken, new URLSearchParams());
  assert.equal(page.accounts.find(row => row.profile === record().profile).displayName, '管理员备注');
  await admin.setAccountName(adminToken, { profile: record().profile, displayName: null });
  assert.equal((await admin.listAccounts(adminToken, new URLSearchParams())).accounts.find(row => row.profile === record().profile).displayName, null);
  assert.deepEqual([...storage.records], before);
  await assert.rejects(admin.setAccountName(adminToken, { profile: 'missing', displayName: '备注' }), { code: 'ACCOUNT_NOT_FOUND' });
  await assert.rejects(admin.listAccounts(a.token, new URLSearchParams()), { code: 'UNAUTHORIZED' });
  await assert.rejects(admin.setAccountName(a.token, { profile: record().profile, displayName: '冒名' }), { code: 'UNAUTHORIZED' });
  for (const displayName of ['', ' ', ' padded', 'a'.repeat(81), 'x\ny']) await assert.rejects(admin.setAccountName(adminToken, { profile: record().profile, displayName }), { code: 'INVALID_RECORD' });
});

test('account pagination is bounded and direction is explicit and included in record cursor binding', async () => {
  const { storage, service } = setup(); const a = await service.createSession({});
  const adminToken = 'e'.repeat(64); storage.adminSessions.set(hash(adminToken), '2026-11-11T00:00:00.000Z');
  const admin = new ArchiveAdminService(storage, () => new Date('2026-11-10T00:00:00.000Z'));
  const records = Array.from({ length: 51 }, (_, index) => record(index + 1, { profile: 'account-' + index }));
  await service.saveRecords(a.token, { records: records.slice(0, 50) }); await service.saveRecords(a.token, { records: records.slice(50) });
  const first = await admin.listAccounts(adminToken, new URLSearchParams());
  const second = await admin.listAccounts(adminToken, new URLSearchParams({ cursor: first.nextCursor }));
  assert.equal(first.accounts.length, 50); assert.equal(second.accounts.length, 1); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.accounts, ...second.accounts].map(row => row.profile)).size, 51);
  for (const query of ['cursor=', 'cursor=bad', 'profile=foo', 'cursor=a&cursor=b']) await assert.rejects(admin.listAccounts(adminToken, new URLSearchParams(query)));
  await service.saveRecords(a.token, { records: [record(100, { profile: records[0].profile, direction: 'outgoing', source: 'auto_reply', status: 'sent' })] });
  const incoming = await admin.listRecords(adminToken, new URLSearchParams({ profile: records[0].profile, direction: 'incoming' }));
  assert.equal(incoming.records.length, 1); assert.equal(incoming.records[0].direction, 'incoming');
  const outgoing = await admin.listRecords(adminToken, new URLSearchParams({ profile: records[0].profile, direction: 'outgoing' }));
  assert.equal(outgoing.records.length, 1); assert.equal(outgoing.records[0].direction, 'outgoing');
  assert.equal((await admin.listRecords(adminToken, new URLSearchParams({ profile: records[0].profile }))).records.length, 2);
  const many = await admin.listRecords(adminToken, new URLSearchParams({ direction: 'incoming' }));
  await assert.rejects(admin.listRecords(adminToken, new URLSearchParams({ direction: 'outgoing', cursor: many.nextCursor })), { code: 'INVALID_CURSOR' });
  for (const query of ['direction=', 'direction=all', 'direction=received', 'direction=incoming&direction=outgoing']) await assert.rejects(admin.listRecords(adminToken, new URLSearchParams(query)), { code: 'INVALID_QUERY' });
});
