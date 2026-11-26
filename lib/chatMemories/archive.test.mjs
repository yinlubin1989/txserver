import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getOverview, getDay, getQuestionEvidence } from './archive.ts';

let directory;
const previous = process.env.CHAT_MEMORIES_DB;
before(() => {
  directory = mkdtempSync(join(tmpdir(), 'chat-memories-test-'));
  const path = join(directory, 'archive.sqlite3');
  const db = new DatabaseSync(path);
  try {
    db.exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY, seq INTEGER UNIQUE, day TEXT, clock TEXT,
      sender TEXT, kind TEXT, body TEXT, quote TEXT, verified INTEGER);
      CREATE TABLE coverage (day TEXT PRIMARY KEY, complete INTEGER);
      INSERT INTO coverage VALUES ('2025-11-26', 1);`);
    const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < 31; ++i) {
      insert.run(1000 - i, i - 29, '2025-11-26', '09:00', i % 2 ? 'peer' : 'me', 'text',
        i === 0 ? '你好你好' : i === 1 ? '你好' : '收到', '你好', 1);
    }
    insert.run(1001, 2, '2025-11-26', '09:01', 'peer', 'voice', '媒体占位', null, 1);
    insert.run(1002, 3, '2025-11-26', '09:01', 'me', 'call', null, null, 1);
    insert.run(1003, 4, '2025-12-01', null, 'peer', 'text', '散步', null, 1);
    insert.run(1004, 5, '2025-12-01', null, 'peer', 'text', '草稿', null, 0);
  } finally { db.close(); }
  process.env.CHAT_MEMORIES_DB = path;
});
after(() => {
  if (previous === undefined) delete process.env.CHAT_MEMORIES_DB;
  else process.env.CHAT_MEMORIES_DB = previous;
  rmSync(directory, { recursive: true, force: true });
});

test('Beijing anniversary preserves sequence and zero cursor, with calls counted separately', () => {
  const { stats, anniversary } = getOverview(new Date('2026-11-25T16:05:00Z'));
  assert.deepEqual({ ...stats }, {
    messages: 33, calls: 1, text: 32, voice: 1, me: 16, peer: 17, days: 2,
    firstDay: '2025-11-26', lastDay: '2025-12-01',
  });
  assert.equal(anniversary.day, '2025-11-26');
  assert.equal(anniversary.items[0].id, 1000);
  assert.equal(anniversary.items.length, 30);
  assert.equal(anniversary.nextCursor, 0);
  const next = getDay(anniversary.day, anniversary.nextCursor);
  assert.deepEqual(next.items.map(row => row.id), [970, 1001, 1002]);
  assert.equal(next.items[1].body, null);
  assert.equal(next.nextCursor, null);
  assert.deepEqual(getDay('2020-01-01'), { day: '2020-01-01', items: [], nextCursor: null });
  assert.deepEqual(getOverview(new Date('2024-02-29T01:00Z')).anniversary, { day: null, items: [], nextCursor: null });
});

test('word metrics use own text, contexts keep immediate replies and respect dates', () => {
  const result = getQuestionEvidence({ startDay: '2025-11-26', endDay: '2025-11-26', keywords: ['你好'] });
  assert.equal(result.scope.complete, true);
  assert.equal(result.scope.matchedMessages, 2);
  assert.deepEqual(result.keywordCounts, [
    { keyword: '你好', sender: 'me', messages: 1, occurrences: 2, exactMessages: 0 },
    { keyword: '你好', sender: 'peer', messages: 1, occurrences: 1, exactMessages: 1 },
  ]);
  assert.deepEqual(result.anchorIds, [1000, 999]);
  assert.deepEqual(result.samples.map(row => row.id), [1000, 999, 998]);
  const sender = getQuestionEvidence({ sender: 'peer', keywords: ['你好', '%'] });
  assert.deepEqual(sender.anchorIds, [999]);
  assert.ok(sender.samples.some(row => row.sender === 'me'));
  assert.equal(sender.keywordCounts[1].messages, 0);
  assert.equal(sender.scope.complete, false);
  const none = getQuestionEvidence({ startDay: '2025-12-01', endDay: '2025-12-01', keywords: ['草稿'] });
  assert.equal(none.scope.complete, false);
  assert.equal(none.scope.matchedMessages, 0);
  assert.deepEqual(none.samples, []);
});

test('rejects invalid real dates, input limits and unordered ranges', () => {
  assert.throws(() => getDay('2025-02-29'), RangeError);
  assert.throws(() => getDay('2024-02-29', 0.5), RangeError);
  assert.throws(() => getQuestionEvidence({ startDay: '2025-12-01', endDay: '2025-11-01' }), RangeError);
  assert.throws(() => getQuestionEvidence({ keywords: [' '] }), RangeError);
  assert.throws(() => getQuestionEvidence({ keywords: Array(9).fill('词') }), RangeError);
});

test('aggregate questions leave the text on the server and measure only sender changes', () => {
  const result = getQuestionEvidence({ includeExcerpts: false, includeConversationStats: true });
  assert.equal(result.scope.matchedMessages, 32);
  assert.deepEqual(result.samples, []);
  assert.deepEqual(result.anchorIds, []);
  assert.deepEqual(result.conversationStats, {
    sessionsStarted: { me: 1, peer: 0 },
    replies: {
      me: { count: 15, medianMinutes: 0, meanMinutes: 0 },
      peer: { count: 16, medianMinutes: 0, meanMinutes: 0.1 },
    },
    skippedUndated: 1,
  });
});

test('sessions cross midnight, use the previous last bubble, and restart at exactly four hours', () => {
  const writer = new DatabaseSync(process.env.CHAT_MEMORIES_DB);
  try {
    writer.exec(`INSERT INTO messages VALUES
      (1101, 6, '2026-01-01', '23:50', 'peer', 'text', '约好了', null, 1),
      (1102, 7, '2026-01-01', '23:55', 'peer', 'text', '明天见', null, 1),
      (1103, 8, '2026-01-02', '00:03', 'me', 'text', '收到', null, 1),
      (1104, 9, '2026-01-02', '03:00', 'me', 'call', null, null, 1),
      (1105, 10, '2026-01-02', '04:03', 'peer', 'text', '出发了', null, 1)`);
    const { conversationStats } = getQuestionEvidence({
      startDay: '2026-01-02', endDay: '2026-01-02', includeConversationStats: true, includeExcerpts: false,
    });
    assert.deepEqual(conversationStats.sessionsStarted, { me: 0, peer: 1 });
    assert.deepEqual(conversationStats.replies.me, { count: 1, medianMinutes: 8, meanMinutes: 8 });
    assert.equal(conversationStats.replies.peer.count, 0);
  } finally {
    writer.exec('DELETE FROM messages WHERE id BETWEEN 1101 AND 1105');
    writer.close();
  }
});
