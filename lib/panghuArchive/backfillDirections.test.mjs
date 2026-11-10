import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadModule, record } from './testSupport.mjs';
const { backfillDirections } = loadModule('./backfillDirections.ts');

test('direction backfill is bounded, uses authenticated record.direction, and safely resumes partial batches', async () => {
  const incoming = record(); const outgoing = record(2, { direction: 'outgoing', source: 'outbound', status: 'sent' });
  const rows = [{ id: 'first', record: incoming }, { id: 'second', record: outgoing }];
  const before = structuredClone(rows); const completed = new Map(); let failSecond = true;
  const storage = {
    async readMissing(limit) { return rows.filter(row => !completed.has(row.id)).slice(0, limit); },
    async setDirection(id, direction) { if (id === 'second' && failSecond) throw new Error('fake database timeout'); completed.set(id, direction); return true; },
  };
  await assert.rejects(backfillDirections(storage, 2), /fake database timeout/);
  assert.equal(completed.get('first'), 'incoming'); assert.equal(completed.has('second'), false);
  failSecond = false;
  assert.deepEqual(await backfillDirections(storage, 2), { scanned: 1, updated: 1, complete: false });
  assert.equal(completed.get('second'), 'outgoing');
  assert.deepEqual(await backfillDirections(storage, 2), { scanned: 0, updated: 0, complete: true });
  assert.deepEqual(rows, before);
  for (const limit of [0, 501, 1.5]) await assert.rejects(backfillDirections(storage, limit));
});

test('maintenance CLI refuses to connect or write without the explicit operator flag', () => {
  const env = { ...process.env }; delete env.PANGHU_ARCHIVE_ALLOW_DIRECTION_BACKFILL;
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./backfillDirections.mjs', import.meta.url))], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
  const failure = JSON.parse(result.stderr.trim());
  assert.equal(failure.complete, false); assert.equal(failure.scanned, 0); assert.equal(failure.updated, 0);
});
