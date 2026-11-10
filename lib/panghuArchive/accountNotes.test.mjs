import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, loadModule } from './testSupport.mjs';
const { encryptAccountName, decryptAccountName } = loadModule('./accountNotes.ts');
test('account names are encrypted separately and authenticated to exact profile and update time', () => {
  const key = Buffer.alloc(32, 7); const value = { profile: 'fake-corp:fake-person', displayName: '虚构管理员备注' };
  const binding = { profileHash: hash(value.profile), updatedAt: '2026-11-10T02:00:00.000Z' };
  const encrypted = encryptAccountName(value, binding, key);
  assert.equal(JSON.stringify(encrypted).includes(value.profile), false); assert.equal(JSON.stringify(encrypted).includes(value.displayName), false);
  assert.deepEqual(decryptAccountName(encrypted, binding, key), value);
  for (const changed of [{ ...binding, profileHash: hash('other') }, { ...binding, updatedAt: '2026-11-10T03:00:00.000Z' }]) assert.throws(() => decryptAccountName(encrypted, changed, key), { code: 'ARCHIVE_UNAVAILABLE' });
  assert.throws(() => decryptAccountName({ ...encrypted, data: Buffer.from('tampered').toString('base64') }, binding, key), { code: 'ARCHIVE_UNAVAILABLE' });
});
