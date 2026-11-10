import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { loadModule, record, setup } from './testSupport.mjs';

function routes() {
  const { storage } = setup();
  const errors = loadModule('./errors.ts');
  const http = loadModule('./http.ts', { './errors': errors, './storage': { mongoArchiveStorage: storage }, './limits': { limitRequest() {} } });
  const validation = loadModule('./validation.ts', { './errors': errors });
  const overrides = { '@/lib/panghuArchive/http': http, '@/lib/panghuArchive/validation': validation };
  return { storage, http,
    session: loadModule('../../app/api/panghu-archive/session/route.ts', overrides),
    records: loadModule('../../app/api/panghu-archive/records/route.ts', overrides),
    admin: loadModule('../../app/api/panghu-archive/admin/session/route.ts', overrides),
    adminRecords: loadModule('../../app/api/panghu-archive/admin/records/route.ts', overrides),
  };
}
function request(method, body, token, headers = {}, path = 'records') {
  return new Request(`https://archive.example.test/api/panghu-archive/${path}`, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
test('client routes expose exact no-store contracts and every POST error includes acceptedIds', async () => {
  const ctx = routes();
  const created = await ctx.session.POST(request('POST', {}));
  assert.equal(created.status, 201); assert.equal(created.headers.get('cache-control'), 'no-store');
  const { session: { token } } = await created.json();
  const post = await ctx.records.POST(request('POST', { records: [record()] }, token));
  assert.deepEqual(await post.json(), { ok: true, acceptedIds: [record().id] });
  for (const req of [request('POST', { records: [record()] }), request('POST', { records: [record()], ownerHash: 'forged' }, token), new Request('https://archive.example.test', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{' }), request('POST', { records: [record()] }, token, { 'content-length': '2097153' }), request('POST', {}, token, { 'content-type': 'text/plain' })]) {
    const response = await ctx.records.POST(req); assert.ok(response.status >= 400); assert.deepEqual((await response.json()).acceptedIds, []);
  }
  ctx.storage.failAt = ctx.storage.insertCount + 2;
  const partial = await ctx.records.POST(request('POST', { records: [record(2), record(3), record(4)] }, token));
  assert.equal(partial.status, 503); assert.deepEqual((await partial.json()).acceptedIds, [record(2).id]);
  const list = await ctx.records.GET(request('GET', undefined, token)); const body = await list.json();
  assert.equal(body.ok, true); assert.equal(body.records.length, 2); assert.equal(body.nextCursor, null);
  const invalid = await ctx.records.GET(request('GET', undefined, token, {}, 'records?ownerHash=forged')); assert.equal(invalid.status, 400);
});

test('streamed bodies are bounded without trusting content-length', async () => {
  const { http } = routes();
  const req = new Request('https://archive.example.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(1025) });
  await assert.rejects(http.readBody(req, 1024), { code: 'BODY_TOO_LARGE' });
});

test('admin HTTP uses only secure cookies and rejects CSRF, duplicate cookies and bearer escalation', async () => {
  const previousHash = process.env.PANGHU_ARCHIVE_ADMIN_PASSWORD_HASH; const previousOrigin = process.env.PANGHU_ARCHIVE_ADMIN_ORIGIN;
  try {
    process.env.PANGHU_ARCHIVE_ADMIN_PASSWORD_HASH = bcrypt.hashSync('fake-password', 4);
    process.env.PANGHU_ARCHIVE_ADMIN_ORIGIN = 'https://archive.example.test';
    const ctx = routes(); const user = await ctx.http.archiveService.createSession({});
    await ctx.http.archiveService.saveRecords(user.token, { records: [record()] });
    const badOrigin = await ctx.admin.POST(request('POST', { password: 'fake-password' }, null, { origin: 'https://other.example.test' })); assert.equal(badOrigin.status, 403);
    const login = await ctx.admin.POST(request('POST', { password: 'fake-password' }, null, { origin: 'https://archive.example.test' }));
    assert.deepEqual(await login.json(), { ok: true, authenticated: true });
    const cookieHeader = login.headers.get('set-cookie');
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=43200', 'Path=/api/panghu-archive/admin']) assert.ok(cookieHeader.includes(flag));
    const cookie = cookieHeader.split(';')[0];
    const denied = await ctx.adminRecords.GET(request('GET', undefined, user.token)); assert.equal(denied.status, 401);
    assert.equal((await ctx.admin.GET(request('GET', undefined, null, { cookie }))).status, 200);
    assert.equal((await ctx.admin.GET(request('GET', undefined, null, { cookie: `${cookie}; ${cookie}` }))).status, 401);
    const all = await ctx.adminRecords.GET(request('GET', undefined, null, { cookie })); assert.equal((await all.json()).records.length, 1);
    assert.equal((await ctx.admin.DELETE(request('DELETE', undefined, null, { cookie }))).status, 403);
    const logout = await ctx.admin.DELETE(request('DELETE', undefined, null, { cookie, origin: 'https://archive.example.test' }));
    assert.deepEqual(await logout.json(), { ok: true, authenticated: false }); assert.ok(logout.headers.get('set-cookie').includes('Max-Age=0'));
    assert.equal((await ctx.admin.GET(request('GET', undefined, null, { cookie }))).status, 401);
  } finally {
    if (previousHash === undefined) delete process.env.PANGHU_ARCHIVE_ADMIN_PASSWORD_HASH; else process.env.PANGHU_ARCHIVE_ADMIN_PASSWORD_HASH = previousHash;
    if (previousOrigin === undefined) delete process.env.PANGHU_ARCHIVE_ADMIN_ORIGIN; else process.env.PANGHU_ARCHIVE_ADMIN_ORIGIN = previousOrigin;
  }
});
