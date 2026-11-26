type Sender = 'me' | 'peer';
export type Message = {
  id: number;
  day: string;
  clock: string | null;
  sender: Sender;
  kind: string;
  body: string | null;
};
type SequencedMessage = Message & { seq: number };
type ArchiveStats = {
  messages: number; calls: number; text: number; voice: number;
  me: number; peer: number; days: number; firstDay: string | null; lastDay: string | null;
};

export type EvidenceQuery = {
  startDay?: string | null;
  endDay?: string | null;
  sender?: Sender | null;
  keywords?: string[];
  includeExcerpts?: boolean;
  includeConversationStats?: boolean;
};

type SqlValue = string | number | null;
type Filter = { sql: string; args: SqlValue[] };
// The deployed Node runtime supplies SQLite. Keep its small read-only interface
// local while the rest of txserver uses the Node 20 type definitions.
type ReadDatabase = {
  prepare<Row>(sql: string): { get(...args: SqlValue[]): Row; all(...args: SqlValue[]): Row[] };
  exec(sql: string): void;
  close(): void;
};

const PAGE_SIZE = 30;
const ANCHOR_LIMIT = 12;
const VERIFIED = "verified = 1 AND sender IN ('me', 'peer')";
const MESSAGE_COLUMNS = "id, seq, day, clock, sender, kind, CASE WHEN kind = 'text' THEN body END AS body";
const BEIJING_DAY = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});

function readArchive<T>(read: (db: ReadDatabase) => T): T {
  const sqlite = process.getBuiltinModule('node:sqlite') as {
    DatabaseSync: new (path: string, options: { readOnly: true }) => ReadDatabase;
  } | undefined;
  if (!sqlite) throw new Error('此服务需要支持 SQLite 的 Node 运行环境');
  const path = process.env.CHAT_MEMORIES_DB || '/var/lib/wenwen/chat-memory/messages.sqlite3';
  const db = new sqlite.DatabaseSync(path, { readOnly: true });
  try {
    // All queries in a response see the same archive snapshot.
    db.exec('BEGIN');
    return read(db);
  } finally {
    db.close();
  }
}

export function isArchiveDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function stats(db: ReadDatabase, filter: Filter): ArchiveStats {
  return db.prepare<ArchiveStats>(`
    SELECT count(*) FILTER (WHERE kind <> 'call') AS messages,
           count(*) FILTER (WHERE kind = 'call') AS calls,
           count(*) FILTER (WHERE kind = 'text') AS text,
           count(*) FILTER (WHERE kind = 'voice') AS voice,
           count(*) FILTER (WHERE kind <> 'call' AND sender = 'me') AS me,
           count(*) FILTER (WHERE kind <> 'call' AND sender = 'peer') AS peer,
           count(DISTINCT day) AS days, min(day) AS firstDay, max(day) AS lastDay
      FROM messages WHERE ${filter.sql}`).get(...filter.args);
}

function message(row: SequencedMessage): Message {
  return { id: row.id, day: row.day, clock: row.clock, sender: row.sender, kind: row.kind, body: row.body };
}

function readDay(db: ReadDatabase, day: string, cursor: number | null) {
  const rows = db.prepare<SequencedMessage>(`SELECT ${MESSAGE_COLUMNS} FROM messages
    WHERE ${VERIFIED} AND day = ? ${cursor === null ? '' : 'AND seq > ?'} ORDER BY seq LIMIT ?`)
    .all(day, ...(cursor === null ? [] : [cursor]), PAGE_SIZE + 1);
  const items = rows.slice(0, PAGE_SIZE).map(message);
  return { day, items, nextCursor: rows.length > PAGE_SIZE ? rows[PAGE_SIZE - 1].seq : null };
}

export function getDay(day: string, cursor: number | null = null) {
  if (!isArchiveDay(day) || (cursor !== null && !Number.isSafeInteger(cursor))) {
    throw new RangeError('无效的日期或游标');
  }
  return readArchive(db => readDay(db, day, cursor));
}

export function getOverview(now = new Date()) {
  const today = BEIJING_DAY.format(now);
  const lastYear = String(Number(today.slice(0, 4)) - 1).padStart(4, '0') + today.slice(4);
  return readArchive(db => ({
    stats: stats(db, { sql: VERIFIED, args: [] }),
    anniversary: isArchiveDay(lastYear) ? readDay(db, lastYear, null) : { day: null, items: [], nextCursor: null },
  }));
}

function scopeFilter(start: string | null, end: string | null, sender: Sender | null): Filter {
  const clauses = [VERIFIED];
  const args: SqlValue[] = [];
  if (start !== null) { clauses.push('day >= ?'); args.push(start); }
  if (end !== null) { clauses.push('day <= ?'); args.push(end); }
  if (sender !== null) { clauses.push('sender = ?'); args.push(sender); }
  return { sql: clauses.join(' AND '), args };
}

function keywordCounts(db: ReadDatabase, filter: Filter, keywords: string[], sender: Sender | null) {
  type Counts = { sender: Sender; messages: number; occurrences: number; exactMessages: number };
  const query = db.prepare<Counts>(`SELECT sender, count(*) AS messages,
      sum((length(body) - length(replace(body, ?, ''))) / length(?)) AS occurrences,
      count(*) FILTER (WHERE body = ?) AS exactMessages
    FROM messages WHERE ${filter.sql} AND kind = 'text' AND instr(body, ?) > 0 GROUP BY sender`);
  const senders: Sender[] = sender ? [sender] : ['me', 'peer'];
  return keywords.flatMap(keyword => {
    const rows = query.all(keyword, keyword, keyword, ...filter.args, keyword);
    return senders.map(person => ({
      keyword, ...(rows.find(row => row.sender === person) ?? { sender: person, messages: 0, occurrences: 0, exactMessages: 0 }),
    }));
  });
}

type Anchor = { id: number; seq: number; day: string; sender: Sender };
function sampleAnchors(db: ReadDatabase, filter: Filter, keywords: string[], includeExcerpts: boolean) {
  const hits = keywords.map(() => 'instr(body, ?) > 0').join(' OR ');
  const where = `FROM messages WHERE ${filter.sql} AND day IS NOT NULL AND kind = 'text'
    AND length(body) > 0 ${hits ? 'AND (' + hits + ')' : ''}`;
  if (!includeExcerpts) {
    const total = db.prepare<{ count: number }>('SELECT count(*) AS count ' + where).get(...filter.args, ...keywords);
    return { anchors: [], matchedMessages: total.count };
  }
  // Fetch only metadata when choosing windows. Original text is read for the selected windows below.
  const candidates = db.prepare<Anchor>(`SELECT id, seq, day, sender ${where} ORDER BY day, seq`)
    .all(...filter.args, ...keywords);
  const months = new Map<string, Anchor[]>();
  for (const row of candidates) {
    const key = row.day.slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key)!.push(row);
  }
  const groups = [...months.values()];
  const selected = groups.length <= ANCHOR_LIMIT ? groups : Array.from({ length: ANCHOR_LIMIT },
    (_, i) => groups[Math.floor(i * (groups.length - 1) / (ANCHOR_LIMIT - 1))]);
  const allocations = selected.map(() => 0);
  const target = Math.min(ANCHOR_LIMIT, selected.reduce((sum, group) => sum + group.length, 0));
  let allocated = 0;
  while (allocated < target) {
    for (let i = 0; i < selected.length && allocated < target; i++) {
      if (allocations[i] < selected[i].length) { allocations[i]++; allocated++; }
    }
  }
  const anchors: Anchor[] = [];
  selected.forEach((group, month) => {
    const count = allocations[month];
    for (let i = 0; i < count; i++) {
      const segment = group.slice(Math.floor(i * group.length / count), Math.floor((i + 1) * group.length / count));
      const preferred = segment.filter(row => row.sender === (anchors.length % 2 ? 'me' : 'peer'));
      const pool = preferred.length ? preferred : segment;
      anchors.push(pool[Math.floor(pool.length / 2)]);
    }
  });
  return { anchors, matchedMessages: candidates.length };
}

function surroundingMessages(db: ReadDatabase, anchors: Anchor[]) {
  const select = `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE ${VERIFIED} AND day = ?`;
  const before = db.prepare<SequencedMessage>(select + ' AND seq < ? ORDER BY seq DESC LIMIT 1');
  const after = db.prepare<SequencedMessage>(select + ' AND seq >= ? ORDER BY seq LIMIT 2');
  const rows = new Map<number, SequencedMessage>();
  for (const anchor of anchors) {
    for (const row of [...before.all(anchor.day, anchor.seq), ...after.all(anchor.day, anchor.seq)]) {
      rows.set(row.id, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.seq - b.seq).map(message);
}

function coverageComplete(db: ReadDatabase, start: string | null, end: string | null) {
  if (!start || !end) return false;
  const requestedDays = 1 + (Date.parse(end) - Date.parse(start)) / 86400000;
  const reviewed = db.prepare<{ days: number }>(
    'SELECT count(*) AS days FROM coverage WHERE complete = 1 AND day BETWEEN ? AND ?'
  ).get(start, end);
  if (reviewed.days !== requestedDays) return false;
  // Same sequence bounds as the archive importer: an undated row is unresolved
  // unless a dated neighbour places it strictly outside the requested interval.
  const unresolved = db.prepare<{ present: number }>(`SELECT EXISTS(
    SELECT 1 FROM messages m
    WHERE (m.verified = 1 AND m.day BETWEEN ? AND ? AND (m.sender = 'unknown' OR m.kind = 'unknown'))
       OR ((m.day IS NULL OR m.verified = 0)
           AND NOT EXISTS (SELECT 1 FROM messages earlier WHERE earlier.verified = 1 AND earlier.day > ? AND earlier.seq < m.seq)
           AND NOT EXISTS (SELECT 1 FROM messages later WHERE later.verified = 1 AND later.day < ? AND later.seq > m.seq))
    ) AS present`).get(start, end, end, start);
  return unresolved.present === 0;
}

function replyDurations(minutes: number[]) {
  const count = minutes.length;
  if (!count) return { count, medianMinutes: null, meanMinutes: null };
  minutes.sort((a, b) => a - b);
  return {
    count,
    medianMinutes: (minutes[Math.floor((count - 1) / 2)] + minutes[Math.floor(count / 2)]) / 2,
    meanMinutes: Math.round(10 * minutes.reduce((a, b) => a + b, 0) / count) / 10,
  };
}

function conversationStats(db: ReadDatabase, start: string | null, end: string | null) {
  type Entry = { day: string | null; minute: number | null; sender: Sender };
  // Establish the previous sender/time before applying date filters, so a
  // conversation continuing across midnight does not become a new session.
  const rows = db.prepare<Entry>(`SELECT day, sender,
    CAST(strftime('%s', day || ' ' || clock) AS INTEGER) / 60 AS minute
    FROM messages WHERE ${VERIFIED} AND kind <> 'call' ORDER BY seq`).all();
  const sessionsStarted = { me: 0, peer: 0 };
  const durations: Record<Sender, number[]> = { me: [], peer: [] };
  let previous: Entry | undefined;
  let skippedUndated = 0;
  for (const row of rows) {
    const inRange = (!start || !row.day || start <= row.day) && (!end || !row.day || end >= row.day);
    if (inRange) {
      if (row.minute === null) {
        skippedUndated++;
      } else if (!previous || (previous.minute !== null && row.minute - previous.minute >= 240)) {
        sessionsStarted[row.sender]++;
      } else if (previous.minute !== null && previous.sender !== row.sender && row.minute >= previous.minute) {
        durations[row.sender].push(row.minute - previous.minute);
      }
    }
    previous = row;
  }
  return { sessionsStarted, replies: { me: replyDurations(durations.me), peer: replyDurations(durations.peer) }, skippedUndated };
}

export function getQuestionEvidence(query: EvidenceQuery) {
  const { startDay = null, endDay = null, sender = null, keywords = [], includeExcerpts = true, includeConversationStats = false } = query;
  if ((startDay !== null && !isArchiveDay(startDay)) || (endDay !== null && !isArchiveDay(endDay))
    || (startDay && endDay && startDay > endDay) || (sender !== null && sender !== 'me' && sender !== 'peer')
    || typeof includeExcerpts !== 'boolean' || typeof includeConversationStats !== 'boolean'
    || !Array.isArray(keywords) || keywords.length > 8
    || keywords.some(term => typeof term !== 'string' || !term.trim() || term.includes('\0') || [...term].length > 64)) {
    throw new RangeError('无效的检索范围或关键词');
  }
  const terms = [...new Set(keywords)];
  const filter = scopeFilter(startDay, endDay, sender);
  return readArchive(db => {
    const { anchors, matchedMessages } = sampleAnchors(db, filter, terms, includeExcerpts);
    const samples = anchors.length ? surroundingMessages(db, anchors) : [];
    const byKind = db.prepare<{ sender: Sender; kind: string; count: number }>(`
      SELECT sender, kind, count(*) AS count FROM messages WHERE ${filter.sql} GROUP BY sender, kind
      ORDER BY sender, kind`).all(...filter.args);
    return {
      stats: stats(db, filter), byKind, keywordCounts: keywordCounts(db, filter, terms, sender),
      samples, anchorIds: anchors.map(row => row.id),
      conversationStats: includeConversationStats ? conversationStats(db, startDay, endDay) : null,
      scope: {
        requestedStart: startDay, requestedEnd: endDay, sender,
        complete: coverageComplete(db, startDay, endDay), matchedMessages,
        sampledMessages: samples.length, sampledMonths: [...new Set(anchors.map(row => row.day.slice(0, 7)))],
      },
    };
  });
}
