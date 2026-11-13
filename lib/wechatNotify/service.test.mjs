import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNotifyService, parseNotification } from './service.mjs';
import { WechatTransportError } from './transport.mjs';
import { createHash } from 'node:crypto';
import { createReport, readReport, writeReport, listPendingReports } from '../newsReports/storage.mjs';
import { processReportQueue } from '../newsReports/worker.mjs';
import { processNarration } from '../newsReports/narration.mjs';
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

test('source is normalized metadata and old idempotency fingerprints are preserved', () => {
  const legacy = { title: '', content: '正文', type: '', time: '' };
  assert.equal(parseNotification({ content: '正文' }).hash, createHash('sha256').update(JSON.stringify(legacy)).digest('hex'));
  assert.equal(parseNotification({ source: 'GROKBOT', content: '正文' }).notification.source, 'grokbot');
  assert.equal(parseNotification({ title: '【grokbot】新闻', content: '正文' }).notification.source, undefined);
  assert.equal(parseNotification({ source: 'DOT', title: '【grokbot】新闻', content: '正文' }).notification.source, 'dot');
  for (const source of [null, 1, '', 'has space', '中文', 'x'.repeat(41)]) assert.throws(() => parseNotification({ source, content: '正文' }));
  assert.ok(!Object.hasOwn(parseNotification({ content: '正文' }), 'isNews'));
});

test('daily selection depends only on the trimmed exact type, never on title or source', () => {
  for (const source of ['grokbot', 'DOT', 'muse', 'custom_bot-1', undefined]) {
    const input = { content: '正文', title: '【other】快讯', ...(source === undefined ? {} : { source }) };
    const daily = parseNotification({ ...input, type: ' daily ', reportDate: '2026-11-13' });
    assert.equal(daily.isDaily, true); assert.equal(daily.notification.type, 'daily');
    for (const type of ['news', '日报', 'Daily', 'test', undefined]) {
      assert.equal(parseNotification({ ...input, title: '【grokbot】日报', ...(type === undefined ? {} : { type }) }).isDaily, false);
    }
  }
});

test('breaking news sends directly even when reports are disabled and never creates a report', async t => {
  const { service, calls } = await setup(t, { newsEnabled: () => false,
    createDailyReport: async () => assert.fail('breaking news must not create reports') });
  for (const [i, body] of [{ source: 'grokbot', title: '日报也不能靠标题推断', content: '原文 https://example.com' },
    { title: '【grokbot】快讯', type: 'news', content: '第二条' },
    ...['dot', 'muse', 'custom_bot-1'].map(source => ({ source, title: '【grokbot】日报', type: 'news', content: '直接发送' }))].entries()) {
    const response = await service.notify(request(body, `fast-${i}`));
    const result = await response.json();
    assert.equal(response.status, 202); assert.equal(result.status, 'accepted'); assert.equal(result.report, undefined);
    assert.equal(calls[i][2], parseNotification(body).text);
  }
});

test('daily reports from any source or no source are archived and automatically narrated', async t => {
  const { service, defaults, calls } = await setup(t, { newsEnabled: () => true });
  const sources = ['DOT', 'muse', 'custom_bot-1', undefined];
  for (const [index, source] of sources.entries()) {
    const input = { title: '【grokbot】标题原样保留', type: 'daily', content: `原文 ${index}`, reportDate: '2026-11-13',
      ...(source === undefined ? {} : { source }) };
    const response = await service.notify(request(input, `source-${index}`));
    const body = await response.json();
    assert.equal(response.status, 202); assert.equal(body.report.status, 'queued'); assert.equal(body.report.audioStatus, 'pending');
    const report = await readReport(body.report.id, { directory: defaults.reportsDirectory });
    assert.equal(report.source, source?.toLowerCase() ?? 'external'); assert.equal(report.title, input.title);
    assert.ok(calls[index][2].endsWith(`完整日报与语音：${body.report.url}`));
  }
  const spoken = [];
  await processReportQueue({ directory: defaults.reportsDirectory,
    process: (id, options) => processNarration(id, { ...options, speak: async text => {
      spoken.push(text); return Buffer.concat([Buffer.from('ID3'), Buffer.alloc(160)]);
    } }) });
  assert.deepEqual(spoken, sources.map((_, index) => `原文 ${index}`));
  assert.equal(calls.length, sources.length);
});

test('pre-upgrade finished requests retain their old result without creating pages or resending', async t => {
  const { service, defaults, calls } = await setup(t, { newsEnabled: () => true,
    createDailyReport: async () => assert.fail('old idempotent results must not create a report') });
  for (const [index, source] of [undefined, 'dot'].entries()) {
    const key = `legacy-finished-${index}`;
    const requestId = createHash('sha256').update(key).digest('hex');
    const input = { title: source ? 'x'.repeat(120) : '旧日报', content: source ? '😀'.repeat(2400) : '旧文字通知',
      type: 'daily', time: '', ...(source === undefined ? {} : { source }) };
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    await atomicWriteJson(path.join(defaults.directory, 'requests'), `${requestId}.json`, {
      state: 'finished', hash, body: { status: 'accepted', requestId, deduplicated: false }, httpStatus: 202,
    });
    const response = await service.notify(request(input, key));
    const body = await response.json();
    assert.equal(response.status, 202); assert.equal(body.status, 'accepted');
    assert.equal(body.deduplicated, true); assert.equal(body.report, undefined);
    assert.equal((await service.notify(request({ ...input, source: 'muse' }, key))).status, 409);
    if (source) {
      assert.ok(Buffer.byteLength(parseNotification(input).text) > 9700);
      const fresh = await service.notify(request(input, `${key}-new`));
      assert.equal(fresh.status, 400); assert.equal((await fresh.json()).code, 'INVALID_INPUT');
      const freshId = createHash('sha256').update(`${key}-new`).digest('hex');
      await assert.rejects(readFile(path.join(defaults.directory, 'requests', `${freshId}.json`)), { code: 'ENOENT' });
    }
  }
  assert.equal(calls.length, 0);
  await assert.rejects(readdir(defaults.reportsDirectory), { code: 'ENOENT' });
});

test('pre-upgrade initialization resumes with its original grokbot metadata and existing page', async t => {
  const { service, defaults, calls } = await setup(t, { newsEnabled: () => true });
  for (const [index, source] of [undefined, 'grokbot'].entries()) {
    const key = `legacy-initializing-${index}`;
    const id = createHash('sha256').update(key).digest('hex');
    const input = { title: '【grokbot】旧日报', type: 'daily', content: '旧原文', ...(source === undefined ? {} : { source }) };
    const parsed = parseNotification(input);
    const createdAt = '2026-11-12T00:00:00.000Z', reportDate = '2026-11-12';
    const report = await createReport({ id, notification: parsed.notification, createdAt, reportDate }, { directory: defaults.reportsDirectory });
    const legacy = { ...report, title: '旧日报', source: 'grokbot' };
    await writeReport(legacy, { directory: defaults.reportsDirectory });
    await atomicWriteJson(path.join(defaults.directory, 'requests'), `${id}.json`, {
      state: 'initializing', hash: parsed.hash, createdAt, reportDate, reportId: id,
    });
    const response = await service.notify(request(input, key));
    const body = await response.json();
    assert.equal(response.status, 202); assert.equal(body.report.id, id); assert.equal(body.status, 'accepted');
    assert.deepEqual(await readReport(id, { directory: defaults.reportsDirectory }), legacy);
    assert.ok(calls[index][2].endsWith(`完整日报与语音：${body.report.url}`));
    assert.equal((await service.notify(request({ ...input, title: '改过的标题' }, key))).status, 409);
  }
  assert.equal(calls.length, 2);
});

test('daily report is durable before direct send; statuses stay independent and retries reuse the page', async t => {
  const { service, defaults, calls } = await setup(t, { newsEnabled: () => true });
  const body = { source: 'grokbot', type: 'daily', title: '新闻', content: '正文', reportDate: '2026-11-12' };
  const queued = await service.notify(request(body));
  assert.equal(queued.status, 202);
  const result = await queued.json(); assert.equal(result.status, 'accepted'); assert.equal(calls.length, 1);
  assert.equal(result.report.status, 'queued'); assert.equal(result.report.audioStatus, 'pending');
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
  assert.equal(parseNotification({ source: 'other', type: 'daily', content: 'x' }).isDaily, true);
  const { service, defaults } = await setup(t, { newsEnabled: () => true, now: () => Date.parse('2026-11-12T17:00:00Z') });
  const response = await service.notify(request({ source: 'grokbot', type: 'daily', content: 'x' }));
  const { report } = await response.json();
  assert.equal((await readReport(report.id, { directory: defaults.reportsDirectory })).reportDate, '2026-11-13');
});

test('initialization interrupted before send can resume safely using the same report id', async t => {
  let fail = true, speechCalls = 0;
  const { service, defaults, calls } = await setup(t, { newsEnabled: () => true,
    createDailyReport: async (...args) => { const report = await createReport(...args); if (fail) throw new Error('crash after report persisted'); return report; } });
  const body = { source: 'grokbot', type: 'daily', content: '原文' };
  const first = await service.notify(request(body));
  assert.equal(first.status, 503); const initial = await first.json(); assert.equal(initial.retryable, true); assert.equal(calls.length, 0);
  await processReportQueue({ directory: defaults.reportsDirectory,
    process: (id, options) => processNarration(id, { ...options, speak: async () => {
      speechCalls++; return Buffer.concat([Buffer.from('ID3'), Buffer.alloc(160)]);
    } }) });
  fail = false;
  const second = await service.notify(request(body));
  const resumed = await second.json(); assert.equal(resumed.status, 'accepted'); assert.equal(resumed.report.id, initial.requestId);
  assert.equal(resumed.report.audioStatus, 'ready'); assert.equal(speechCalls, 1);
  assert.equal(calls.length, 1);
  await processReportQueue({ directory: defaults.reportsDirectory,
    process: async () => assert.fail('initialization retry must not regenerate completed audio') });
  assert.equal((await readdir(path.join(defaults.reportsDirectory, 'reports'))).filter(name => name.endsWith('.json')).length, 1);
});

test('report exists at send time and a post-send crash cannot repeat delivery or lose its link', async t => {
  let reportDirectory;
  const { service, defaults, calls } = await setup(t, { newsEnabled: () => true,
    send: async (_account, _context, text) => {
      const id = text.match(/\/news\/([a-f0-9]{64})/u)[1];
      const report = await readReport(id, { directory: reportDirectory });
      assert.equal(report.original.content, '原文'); assert.equal(report.status, 'queued');
      assert.equal(report.audio.status, 'pending');
      assert.equal((await listPendingReports({ directory: reportDirectory }))[0].id, id);
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

test('automatic daily audio never delays its text link or subsequent breaking news', async t => {
  const { service, defaults, calls } = await setup(t, { newsEnabled: () => true });
  const input = { source: 'grokbot', type: 'daily', content: '自动朗读原文' };
  const first = await (await service.notify(request(input, 'automatic-daily'))).json();
  assert.equal(first.status, 'accepted'); assert.equal(first.report.audioStatus, 'pending');
  assert.equal(calls.length, 1); assert.ok(calls[0][2].endsWith(first.report.url));
  let release, started, speechCalls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const began = new Promise(resolve => { started = resolve; });
  const processing = processReportQueue({ directory: defaults.reportsDirectory,
    process: (id, options) => processNarration(id, { ...options, speak: async () => {
      speechCalls++; started(); await gate; return Buffer.concat([Buffer.from('ID3'), Buffer.alloc(160)]);
    } }) });
  t.after(async () => { release(); await processing; });
  await began;
  const breaking = { source: 'grokbot', type: 'news', content: '快讯直接送达' };
  const fast = await (await service.notify(request(breaking, 'fast-during-audio'))).json();
  assert.equal(fast.status, 'accepted'); assert.equal(fast.report, undefined);
  assert.equal(calls.length, 2); assert.equal(calls[1][2], parseNotification(breaking).text);
  assert.equal((await readdir(path.join(defaults.reportsDirectory, 'reports'))).length, 1);
  release(); await processing;
  const repeat = await (await service.notify(request(input, 'automatic-daily'))).json();
  assert.equal(repeat.deduplicated, true); assert.equal(repeat.report.audioStatus, 'ready');
  await processReportQueue({ directory: defaults.reportsDirectory,
    process: async () => assert.fail('completed audio must not be regenerated') });
  assert.equal(speechCalls, 1); assert.equal(calls.length, 2);
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
