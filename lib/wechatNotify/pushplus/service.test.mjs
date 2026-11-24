import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNotifyService } from '../service.mjs';
import { PushplusTransportError } from './transport.mjs';
import { readReport } from '../../newsReports/storage.mjs';

const secret = 'n'.repeat(64);
const pushplusToken = 'a'.repeat(32);
const acceptedReceipt = {
  status: 'accepted', provider: 'pushplus', channel: 'wechat',
  providerMessageId: 'pushplus-message-1', deliveryStatus: 'pending',
};
function request(body = { content: '通知正文' }, key = 'pushplus-test-1') {
  return new Request('https://example.com/api/pushplus/notify', {
    method: 'POST', headers: {
      authorization: `Bearer ${secret}`, 'content-type': 'application/json', 'idempotency-key': key,
    }, body: JSON.stringify(body),
  });
}
function statusRequest() {
  return new Request('https://example.com/api/pushplus/notify/status', {
    headers: { authorization: `Bearer ${secret}` },
  });
}
async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pushplus-service-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = { pushplus: [], credentials: 0, context: 0, clawbot: 0 };
  const defaults = {
    directory, reportsDirectory: path.join(directory, 'news'), secret: () => secret,
    provider: 'pushplus', pushplusToken: () => pushplusToken,
    now: () => Date.parse('2026-11-24T02:10:00.000Z'),
    credentials: async () => { calls.credentials++; throw new Error('ClawBot credentials unavailable'); },
    context: async () => { calls.context++; throw new Error('ClawBot context unavailable'); },
    send: async () => { calls.clawbot++; throw new Error('ClawBot must not send'); },
    pushplusSend: async input => { calls.pushplus.push(input); return { ...acceptedReceipt }; },
  };
  const config = { ...defaults, ...options };
  return { service: createNotifyService(config), config, directory, calls };
}
function assertNoClawbot(calls) {
  assert.equal(calls.credentials, 0);
  assert.equal(calls.context, 0);
  assert.equal(calls.clawbot, 0);
}

test('PushPlus notifications need no ClawBot credentials or inbound conversation', async t => {
  const { service, calls, directory } = await setup(t);
  const response = await service.notify(request({ title: '通知标题', content: '通知正文', type: 'flash', time: '现在' }));
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.status, 'accepted');
  assert.equal(body.provider, 'pushplus');
  assert.equal(body.channel, 'wechat');
  assert.equal(body.deliveryStatus, 'pending');
  assert.equal(body.providerMessageId, acceptedReceipt.providerMessageId);
  assert.deepEqual(calls.pushplus, [{ token: pushplusToken, title: '通知标题', text: '【flash】 通知标题\n\n通知正文\n\n时间：现在' }]);
  assertNoClawbot(calls);
  const journal = await readFile(path.join(directory, 'pushplus-requests', `${body.requestId}.json`), 'utf8');
  assert.ok(!journal.includes(pushplusToken));
  assert.ok(!JSON.stringify(body).includes(pushplusToken));
  const saved = await service.requestStatus(statusRequest(), body.requestId);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), body);
});

test('missing PushPlus token fails locally before reserving or sending', async t => {
  for (const token of [undefined, '']) {
    const { service, calls, directory } = await setup(t, { pushplusToken: () => token });
    const response = await service.notify(request());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).status, 'failed');
    assert.equal(calls.pushplus.length, 0);
    assertNoClawbot(calls);
    assert.deepEqual(await readdir(path.join(directory, 'pushplus-requests')), []);
  }
});

test('PushPlus daily notification sends only after the original report is durable and includes its link', async t => {
  const { config, calls, directory } = await setup(t, { newsEnabled: () => true });
  const key = 'daily-with-pushplus';
  const reportId = createHash('sha256').update('pushplus\0').update(key).digest('hex');
  const service = createNotifyService({ ...config, pushplusSend: async input => {
    calls.pushplus.push(input);
    const report = await readReport(reportId, { directory: config.reportsDirectory });
    assert.ok(report);
    assert.equal(report.original.content, '今天的原始简报');
    assert.equal(report.reportDate, '2026-11-23');
    assert.equal(report.audio.status, 'pending');
    assert.ok(input.text.includes(`/news/${reportId}`));
    const journal = JSON.parse(await readFile(path.join(directory, 'pushplus-requests', `${reportId}.json`), 'utf8'));
    assert.equal(journal.reportId, reportId);
    return { ...acceptedReceipt };
  } });
  const response = await service.notify(request({
    title: '今日简报', content: '今天的原始简报', type: 'daily', source: 'muse', reportDate: '2026-11-23',
  }, key));
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.status, 'accepted');
  assert.equal(body.report.id, reportId);
  assert.equal(body.report.audioStatus, 'pending');
  assert.ok(calls.pushplus[0].text.endsWith(`完整日报与语音：${body.report.url}`));
  assertNoClawbot(calls);
});

test('PushPlus flash forwarding never creates a report, including a title that says daily', async t => {
  let reportCalls = 0;
  const { service, calls } = await setup(t, {
    newsEnabled: () => false,
    createDailyReport: async () => { reportCalls++; throw new Error('Flash must not create reports'); },
  });
  const response = await service.notify(request({ title: '每日日报', content: '快讯原文', type: 'flash' }));
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.report, undefined);
  assert.equal(reportCalls, 0);
  assert.equal(calls.pushplus[0].text, '【flash】 每日日报\n\n快讯原文');
  assertNoClawbot(calls);
});

test('accepted PushPlus requests remain deduplicated across restarts, even without a current token', async t => {
  const { service, config, calls } = await setup(t);
  const original = await (await service.notify(request())).json();
  const restarted = createNotifyService({ ...config, pushplusToken: () => undefined });
  const repeated = await restarted.notify(request());
  assert.equal(repeated.status, 202);
  assert.deepEqual(await repeated.json(), { ...original, deduplicated: true });
  assert.equal(calls.pushplus.length, 1);
  assertNoClawbot(calls);
  assert.equal((await service.notify(request({ content: '不同正文' }))).status, 409);
  assert.equal(calls.pushplus.length, 1);
});

test('PushPlus rejection and uncertain transport outcomes are recorded without fallback or retry', async t => {
  for (const outcome of ['failed', 'unknown']) {
    let attempts = 0;
    const { service, config, calls } = await setup(t, { pushplusSend: async () => {
      attempts++;
      throw new PushplusTransportError('PUSHPLUS_TEST_ERROR', '推送未完成', 502, outcome);
    } });
    const first = await service.notify(request());
    assert.equal(first.status, 502);
    assert.equal((await first.json()).status, outcome);
    const again = await createNotifyService(config).notify(request());
    const repeated = await again.json();
    assert.equal(repeated.status, outcome);
    assert.equal(repeated.deduplicated, true);
    assert.equal(attempts, 1);
    assertNoClawbot(calls);
  }
});

test('incomplete or inconsistent PushPlus receipts never become success', async t => {
  const invalid = [
    undefined,
    { status: 'accepted' },
    { ...acceptedReceipt, status: 'submitted' },
    { ...acceptedReceipt, provider: 'clawbot' },
    { ...acceptedReceipt, channel: 'clawbot' },
    { ...acceptedReceipt, deliveryStatus: 'delivered' },
    { ...acceptedReceipt, deliveryStatus: undefined },
    { ...acceptedReceipt, providerMessageId: '' },
    { ...acceptedReceipt, providerMessageId: 123 },
  ];
  for (const receipt of invalid) {
    let attempts = 0;
    const { service, config, calls } = await setup(t, { pushplusSend: async () => { attempts++; return receipt; } });
    const response = await service.notify(request());
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.status, 'unknown');
    assert.equal(body.code, 'SEND_UNCONFIRMED');
    const replay = await createNotifyService(config).notify(request());
    assert.equal((await replay.json()).status, 'unknown');
    assert.equal(attempts, 1);
    assertNoClawbot(calls);
  }
});

test('PushPlus permits five new sends per minute and resumes next minute', async t => {
  let current = Date.parse('2026-11-24T02:10:00.000Z');
  const { service, calls } = await setup(t, { now: () => current });
  for (let i = 0; i < 5; i++) assert.equal((await service.notify(request(undefined, `rate-${i}`))).status, 202);
  const response = await service.notify(request(undefined, 'rate-5'));
  assert.equal(response.status, 429);
  assert.equal((await response.json()).code, 'RATE_LIMITED');
  assert.equal(calls.pushplus.length, 5);
  current += 60000;
  assert.equal((await service.notify(request(undefined, 'rate-5'))).status, 202);
  assert.equal(calls.pushplus.length, 6);
});

test('PushPlus status reports local configuration without reading ClawBot state or disclosing token', async t => {
  const { service, calls } = await setup(t);
  const response = await service.status(statusRequest());
  const raw = await response.text();
  const body = JSON.parse(raw);
  assert.equal(response.status, 200);
  assert.equal(body.status, 'completed');
  assert.equal(body.provider, 'pushplus');
  assert.equal(body.channel, 'wechat');
  assert.equal(body.configured, true);
  assert.equal(body.contextAvailable, undefined);
  assert.equal(body.listener, undefined);
  assert.equal(body.deliveryStatus, undefined);
  assert.ok(!raw.includes(pushplusToken));
  assert.equal(calls.pushplus.length, 0);
  assertNoClawbot(calls);
});

test('PushPlus status with no token reports a configuration failure', async t => {
  const { service, calls } = await setup(t, { pushplusToken: () => undefined });
  const response = await service.status(statusRequest());
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.status, 'failed');
  assert.equal(body.configured, undefined);
  assertNoClawbot(calls);
});
