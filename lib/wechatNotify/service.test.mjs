import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNotifyService, parseNotification } from './service.mjs';
import { WechatTransportError } from './transport.mjs';
import { createHash } from 'node:crypto';
import { createReport, readReport, writeReport } from '../newsReports/storage.mjs';
import { atomicWriteJson } from './channel.mjs';
const secret = 'n'.repeat(64);
function request(body = { content: 'test' }, key = 'test-1', token = secret) {
  return new Request('https://example.com/api/wechat/notify', { method: 'POST', headers: {
    authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key,
  }, body: JSON.stringify(body) });
}
async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wechat-notify-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [];
  const defaults = { directory, reportsDirectory: path.join(directory, 'reports-store'), secret: () => secret,
    credentials: async () => ({ botToken: 'private-token', recipient: 'owner' }),
    context: async () => ({ recipient: 'owner', contextToken: 'private-context' }),
    send: async (...args) => { calls.push(args); return { status: 'accepted' }; },
  };
  return { service: createNotifyService({ ...defaults, ...options }), defaults, calls, directory };
}
test('notification formats optional fields and validates text and unknown fields', () => {
  assert.equal(parseNotification({ content: '正文', title: '标题', type: '日报', time: '上午' }).text, '【日报】 标题\n\n正文\n\n时间：上午');
  assert.equal(parseNotification({ content: ' 正文 ' }).text, '正文');
  for (const input of [null, [], {}, { content: ' ' }, { content: 1 }, { content: 'x', to: 'other' }, { content: 'x'.repeat(3001) }, { content: '\u0000' }]) assert.throws(() => parseNotification(input));
});
test('unauthorized callers cannot invoke send or disclose configuration', async t => {
  const { service, calls } = await setup(t);
  assert.equal((await service.notify(request(undefined, '1', 'wrong'))).status, 401);
  const status = await service.status(new Request('https://example.com'));
  assert.equal(status.status, 401); assert.equal(calls.length, 0);
});
test('accepted response and persistent deduplication survive service restart', async t => {
  const { service, defaults, calls } = await setup(t);
  const first = await service.notify(request());
  assert.equal(first.status, 202); assert.equal((await first.json()).status, 'accepted');
  const second = await createNotifyService(defaults).notify(request());
  assert.equal((await second.json()).deduplicated, true); assert.equal(calls.length, 1);
  assert.equal((await service.notify(request({ content: 'changed' }))).status, 409);
});
test('concurrent calls never send the same request twice', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; }); let sends = 0;
  const { service } = await setup(t, { send: async () => { sends++; await gate; return { status: 'accepted' }; } });
  const first = service.notify(request());
  while (!sends) await new Promise(resolve => setTimeout(resolve, 5));
  const second = await service.notify(request()); assert.equal(second.status, 409);
  release(); assert.equal((await first).status, 202); assert.equal(sends, 1);
});
test('unknown delivery does not retry, including after restart', async t => {
  let sends = 0;
  const { service, defaults } = await setup(t, { send: async () => {
    sends++; throw new WechatTransportError('WECHAT_TIMEOUT', '发送结果未知', 504, 'unknown');
  } });
  const first = await service.notify(request()); assert.equal((await first.json()).status, 'unknown');
  const again = await createNotifyService({ ...defaults, send: async () => { sends++; } }).notify(request());
  assert.equal((await again.json()).status, 'unknown'); assert.equal(sends, 1);
});
test('missing or mismatched context cannot send or reserve request', async t => {
  const { service, calls, directory } = await setup(t, { context: async () => ({ recipient: 'other', contextToken: 'secret' }) });
  assert.equal((await service.notify(request())).status, 409); assert.equal(calls.length, 0);
  assert.deepEqual(await readdir(path.join(directory, 'requests')), []);
});
test('rate limits, request limits and status fields', async t => {
  const { service, calls } = await setup(t);
  for (let i = 0; i < 10; i++) assert.equal((await service.notify(request(undefined, `key-${i}`))).status, 202);
  assert.equal((await service.notify(request(undefined, 'key-11'))).status, 429);
  assert.equal(calls.length, 10);
  assert.equal((await service.notify(request({ content: 'a'.repeat(20000) }, 'large'))).status, 413);
  assert.equal((await service.notify(request(undefined, '../escape'))).status, 400);
  const response = await service.status(new Request('https://example.com', { headers: { authorization: `Bearer ${secret}` } }));
  const body = await response.text(); assert.ok(!body.includes('private-token')); assert.ok(!body.includes('private-context'));
  assert.equal(JSON.parse(body).contextAvailable, true);
});

test('send accepted but journal storage fails: unknown and never resend after restart', async t => {
  const { service, defaults, calls } = await setup(t, { writeJournal: async () => { throw new Error('disk failure'); } });
  const first = await service.notify(request());
  assert.equal((await first.json()).status, 'unknown'); assert.equal(calls.length, 1);
  const again = await createNotifyService(defaults).notify(request());
  assert.equal((await again.json()).status, 'unknown'); assert.equal(calls.length, 1);
});

test('explicit submitted transport receipt remains distinct from accepted and is deduplicated', async t => {
  let sends = 0;
  const { service } = await setup(t, { send: async () => { sends++; return { status: 'submitted', deliveryStatus: 'unknown', acknowledgement: 'missing_business_status' }; } });
  const first = await service.notify(request());
  assert.equal(first.status, 202);
  const body = await first.json(); assert.equal(body.status, 'submitted'); assert.equal(body.deliveryStatus, 'unknown');
  const second = await service.notify(request()); assert.equal((await second.json()).deduplicated, true); assert.equal(sends, 1);
});

test('source recognition is explicit and old idempotency fingerprints are preserved', () => {
  const legacy = { title: '', content: '正文', type: '', time: '' };
  assert.equal(parseNotification({ content: '正文' }).hash, createHash('sha256').update(JSON.stringify(legacy)).digest('hex'));
  assert.equal(parseNotification({ title: '【grokbot】新闻', content: '正文' }).isNews, true);
  assert.equal(parseNotification({ source: 'GROKBOT', content: '正文' }).isNews, true);
  assert.equal(parseNotification({ source: 'other', content: '正文' }).isNews, false);
  for (const source of [null, 1, '', 'has space']) assert.throws(() => parseNotification({ source, content: '正文' }));
  assert.throws(() => parseNotification({ source: 'other', title: '【grokbot】新闻', content: '正文' }));
});

test('breaking news sends directly even when reports are disabled and never creates a report', async t => {
  const { service, calls } = await setup(t, { newsEnabled: () => false,
    createDailyReport: async () => assert.fail('breaking news must not create reports') });
  for (const [i, body] of [{ source: 'grokbot', title: '日报也不能靠标题推断', content: '原文 https://example.com' },
    { title: '【grokbot】快讯', type: 'news', content: '第二条' }].entries()) {
    const response = await service.notify(request(body, `fast-${i}`));
    const result = await response.json();
    assert.equal(response.status, 202); assert.equal(result.status, 'accepted'); assert.equal(result.report, undefined);
    assert.equal(calls[i][2], parseNotification(body).text);
  }
});

test('daily report is durable before direct send; statuses stay independent and retries reuse the page', async t => {
  const { service, defaults, calls } = await setup(t, { newsEnabled: () => true });
  const body = { source: 'grokbot', type: 'daily', title: '新闻', content: '正文', reportDate: '2026-11-12' };
  const queued = await service.notify(request(body));
  assert.equal(queued.status, 202);
  const result = await queued.json(); assert.equal(result.status, 'accepted'); assert.equal(calls.length, 1);
  assert.equal(result.report.status, 'queued');
  const report = await readReport(result.report.id, { directory: defaults.reportsDirectory });
  assert.equal(report.original.content, '正文'); assert.equal(report.reportDate, '2026-11-12');
  assert.ok(calls[0][2].endsWith(`完整日报与语音：${result.report.url}`));
  const journal = JSON.parse(await readFile(path.join(defaults.directory, 'requests', `${result.requestId}.json`), 'utf8'));
  assert.equal(journal.reportId, result.report.id);
  await writeReport({ ...report, status: 'partial', audio: { status: 'failed', url: null } }, { directory: defaults.reportsDirectory });
  const repeat = await createNotifyService({ ...defaults, newsEnabled: () => true }).notify(request(body));
  const repeated = await repeat.json(); assert.equal(repeated.deduplicated, true); assert.equal(repeated.report.id, result.report.id);
  assert.equal(repeated.report.status, 'partial'); assert.equal(repeated.status, 'accepted'); assert.equal(calls.length, 1);
  const auth = new Request('https://example.com', { headers: { authorization: `Bearer ${secret}` } });
  const status = await service.requestStatus(auth, result.requestId);
  assert.equal((await status.json()).report.status, 'partial');
  assert.equal((await service.requestStatus(new Request('https://example.com'), result.requestId)).status, 401);
  assert.equal((await service.requestStatus(auth, '../context.json')).status, 400);
  assert.equal((await service.requestStatus(auth, 'f'.repeat(64))).status, 404);
});

test('daily requires explicit enablement instead of silently sending text only', async t => {
  const { service, calls } = await setup(t, { newsEnabled: () => false });
  const response = await service.notify(request({ source: 'grokbot', type: 'daily', content: '正文' }));
  assert.equal(response.status, 503); assert.equal((await response.json()).code, 'NEWS_NOT_CONFIGURED');
  assert.equal(calls.length, 0);
});

test('daily selection and calendar date are explicit, and Shanghai dates cross midnight correctly', async t => {
  for (const reportDate of ['2026-02-30', 'bad', null, 123]) assert.throws(() => parseNotification({ source: 'grokbot', type: 'daily', content: 'x', reportDate }));
  assert.throws(() => parseNotification({ source: 'grokbot', content: 'x', reportDate: '2026-11-12' }));
  assert.equal(parseNotification({ source: 'other', type: 'daily', content: 'x' }).isDaily, false);
  const { service, defaults } = await setup(t, { newsEnabled: () => true, now: () => Date.parse('2026-11-12T17:00:00Z') });
  const response = await service.notify(request({ source: 'grokbot', type: 'daily', content: 'x' }));
  const { report } = await response.json();
  assert.equal((await readReport(report.id, { directory: defaults.reportsDirectory })).reportDate, '2026-11-13');
});

test('initialization interrupted before send can resume safely using the same report id', async t => {
  let fail = true;
  const { service, defaults, calls } = await setup(t, { newsEnabled: () => true,
    createDailyReport: async (...args) => { const report = await createReport(...args); if (fail) throw new Error('crash after report persisted'); return report; } });
  const body = { source: 'grokbot', type: 'daily', content: '原文' };
  const first = await service.notify(request(body));
  assert.equal(first.status, 503); const initial = await first.json(); assert.equal(initial.retryable, true); assert.equal(calls.length, 0);
  fail = false;
  const second = await service.notify(request(body));
  const resumed = await second.json(); assert.equal(resumed.status, 'accepted'); assert.equal(resumed.report.id, initial.requestId);
  assert.equal(calls.length, 1);
  assert.equal((await readdir(path.join(defaults.reportsDirectory, 'reports'))).filter(name => name.endsWith('.json')).length, 1);
});

test('report exists at send time and a post-send crash cannot repeat delivery or lose its link', async t => {
  let reportDirectory;
  const { service, defaults, calls } = await setup(t, { newsEnabled: () => true,
    send: async (_account, _context, text) => {
      const id = text.match(/\/news\/([a-f0-9]{64})/u)[1];
      assert.equal((await readReport(id, { directory: reportDirectory })).original.content, '原文');
      calls.push(text); return { status: 'accepted' };
    }, writeJournal: async (directory, filename, value) => {
      if (value.state === 'finished') throw new Error('crash after send');
      return atomicWriteJson(directory, filename, value);
    } });
  reportDirectory = defaults.reportsDirectory;
  const body = { source: 'grokbot', type: 'daily', content: '原文' };
  const first = await service.notify(request(body)); const result = await first.json();
  assert.equal(result.status, 'unknown'); assert.ok(result.report.url);
  const retry = await createNotifyService({ ...defaults, newsEnabled: () => true }).notify(request(body));
  assert.equal((await retry.json()).status, 'unknown'); assert.equal(calls.length, 1);
});

test('incomplete submitted receipts are never treated as confirmed submission', async t => {
  const { service } = await setup(t, { send: async () => ({ status: 'submitted' }) });
  const response = await service.notify(request());
  assert.equal((await response.json()).status, 'unknown');
});

test('report storage failure is reported separately without changing accepted delivery', async t => {
  const { service, defaults, calls } = await setup(t, { newsEnabled: () => true });
  const input = { source: 'grokbot', type: 'daily', content: '原文' };
  const first = await (await service.notify(request(input))).json();
  const unavailable = createNotifyService({ ...defaults, newsEnabled: () => true, readDailyReport: async () => { throw new Error('disk unavailable'); } });
  const auth = new Request('https://example.com', { headers: { authorization: `Bearer ${secret}` } });
  const body = await (await unavailable.requestStatus(auth, first.requestId)).json();
  assert.equal(body.status, 'accepted'); assert.equal(body.report, null); assert.equal(body.reportError.code, 'REPORT_UNAVAILABLE');
  const repeated = await (await unavailable.notify(request(input))).json();
  assert.equal(repeated.status, 'accepted'); assert.equal(repeated.deduplicated, true); assert.equal(calls.length, 1);
});
