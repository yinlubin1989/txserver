import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readReport } from '../newsReports/storage.mjs';
import { parseNotification } from './service.mjs';

function auth(key) {
  return { authorization: 'Bearer ' + key };
}
function post(key, content, messageId, type = 'text') {
  return new Request('https://example.com', {
    method: 'POST', headers: { ...auth(key), 'Content-Type': 'application/json', 'Idempotency-Key': messageId },
    body: JSON.stringify({ content, type }),
  });
}
function query(key) {
  return new Request('https://example.com', { headers: auth(key) });
}

test('the two deployed notification services isolate credentials, sends, journals, rates and report IDs', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'notify-services-'));
  const clawKey = 'c'.repeat(64);
  const pushKey = 'p'.repeat(64);
  const clawDir = path.join(root, 'claw');
  const pushDir = path.join(root, 'push');
  const reports = path.join(root, 'news');
  const settings = {
    WECHAT_NOTIFY_STATE_DIR: clawDir, PUSHPLUS_NOTIFY_STATE_DIR: pushDir,
    WECHAT_NOTIFY_PROVIDER: 'pushplus', WECHAT_NEWS_ENABLED: 'true', PUSHPLUS_NEWS_ENABLED: 'true', NEWS_REPORTS_DIR: reports,
    WECHAT_NOTIFY_API_KEY: clawKey, PUSHPLUS_NOTIFY_API_KEY: pushKey, PUSHPLUS_TOKEN: 'test-token',
  };
  t.mock.method(Date, 'now', () => Date.UTC(2026, 10, 24, 4));
  const oldValues = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(async () => {
    for (const [key, value] of Object.entries(oldValues)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(clawDir, 'requests'), { recursive: true });
  await writeFile(path.join(clawDir, 'credentials.json'), JSON.stringify({ recipient: 'test', botToken: 'test-bot' }));
  await writeFile(path.join(clawDir, 'context.json'), JSON.stringify({ recipient: 'test', contextToken: 'test-session', cursor: '', updatedAt: null }));

  const sends = { pushplus: 0, clawbot: 0 };
  t.mock.method(globalThis, 'fetch', async url => {
    if (url === 'https://www.pushplus.plus/send') {
      sends.pushplus++;
      return Response.json({ code: 200, data: 'test-serial' });
    }
    assert.equal(url, 'https://ilinkai.weixin.qq.com/ilink/bot/sendmessage');
    sends.clawbot++;
    return Response.json({ ret: 0 });
  });
  const { pushplusNotify } = await import('./pushplus/runtime.mjs');
  const { wechatNotify } = await import('./runtime.mjs');
  assert.equal((await pushplusNotify.notify(post(clawKey, 'x', 'test'))).status, 401);
  assert.equal((await wechatNotify.notify(post(pushKey, 'x', 'test'))).status, 401);
  assert.equal((await (await wechatNotify.status(query(clawKey))).json()).channel, 'weixin-ilink');
  assert.equal((await (await pushplusNotify.status(query(pushKey))).json()).channel, 'wechat');

  process.env.PUSHPLUS_NEWS_ENABLED = 'false';
  assert.equal((await pushplusNotify.notify(post(pushKey, '暂停日报', 'paused', 'daily'))).status, 503);
  process.env.PUSHPLUS_NEWS_ENABLED = 'true';
  const [claw, push] = await Promise.all([
    wechatNotify.notify(post(clawKey, '机器人日报', 'same', 'daily')),
    pushplusNotify.notify(post(pushKey, '服务号日报', 'same', 'daily')),
  ]);
  assert.equal(claw.status, 202);
  assert.equal(push.status, 202);
  const [a, b] = await Promise.all([claw.json(), push.json()]);
  assert.equal(a.requestId, createHash('sha256').update('same').digest('hex'));
  assert.notEqual(a.requestId, b.requestId);
  assert.notEqual(a.report.id, b.report.id);
  assert.equal((await readReport(a.report.id, { directory: reports })).original.content, '机器人日报');
  assert.equal((await readReport(b.report.id, { directory: reports })).original.content, '服务号日报');
  assert.equal((await pushplusNotify.requestStatus(query(pushKey), a.requestId)).status, 404);
  assert.equal((await wechatNotify.requestStatus(query(clawKey), b.requestId)).status, 404);
  assert.deepEqual(sends, { pushplus: 1, clawbot: 1 });

  // Receipts written by the old shared endpoint keep their original lookup and retry behavior.
  const legacyKey = 'pre-split';
  const legacyId = createHash('sha256').update(legacyKey).digest('hex');
  const previous = { ...b, requestId: legacyId };
  delete previous.report;
  const file = path.join(clawDir, 'requests', legacyId + '.json');
  await writeFile(file, JSON.stringify({ state: 'finished', provider: 'pushplus', httpStatus: 202,
    hash: parseNotification({ content: '历史消息', type: 'text' }).hash, body: previous }));
  assert.deepEqual(await (await wechatNotify.requestStatus(query(clawKey), legacyId)).json(), previous);
  assert.equal((await (await wechatNotify.notify(post(clawKey, '历史消息', legacyKey))).json()).deduplicated, true);
  assert.equal((await pushplusNotify.requestStatus(query(pushKey), legacyId)).status, 404);
  assert.deepEqual(sends, { pushplus: 1, clawbot: 1 });

  await writeFile(file, JSON.stringify({ state: 'initializing', provider: 'pushplus', reportId: legacyId,
    hash: parseNotification({ content: '旧日报', type: 'daily' }).hash }));
  assert.equal((await (await wechatNotify.requestStatus(query(clawKey), legacyId)).json()).retryable, false);
  const interrupted = await wechatNotify.notify(post(clawKey, '旧日报', legacyKey, 'daily'));
  assert.equal(interrupted.status, 409);
  assert.equal((await interrupted.json()).code, 'CHANNEL_CHANGED');
  assert.deepEqual(sends, { pushplus: 1, clawbot: 1 });

  for (let i = 0; i < 4; i++) {
    assert.equal((await pushplusNotify.notify(post(pushKey, '通知', 'push-' + i))).status, 202);
  }
  assert.equal((await pushplusNotify.notify(post(pushKey, '通知', 'sixth'))).status, 429);
  assert.equal((await wechatNotify.notify(post(clawKey, '通知', 'sixth'))).status, 202);
  assert.deepEqual(sends, { pushplus: 5, clawbot: 2 });
});
