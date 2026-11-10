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
