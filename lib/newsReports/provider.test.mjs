import test from 'node:test';
import assert from 'node:assert/strict';
import { searchWeb, fetchPage, generateStructured, safeSourceUrl, sourceUrlsIn } from './provider.mjs';
import { validateBody, planResearch } from './researchContent.mjs';

const result = { title: '原始公告', url: 'https://example.org/news', snippet: '摘要', summary: '详情', content: '正文',
  site_name: '来源', date: null, authority: 3, rerank_score: 2 };
const response = value => async () => Response.json(value);
test('search uses the fixed endpoint and validates the documented results payload', async () => {
  let endpoint, payload;
  const rows = await searchWeb('事件', { key: 'private', fetchImpl: async (url, options) => {
    endpoint = url; payload = JSON.parse(options.body); return Response.json({ results: [result] });
  } });
  assert.equal(endpoint, 'https://api.deepseek.com/v1/tools/search');
  assert.deepEqual(payload, { query: '事件', count: 5, need_content: true });
  assert.equal(rows[0].content, '正文');
  assert.deepEqual(await searchWeb('事件', { key: 'x', fetchImpl: response({ results: [] }) }), []);
  await assert.rejects(searchWeb('事件', { key: 'x', fetchImpl: response({ items: [result] }) }), { code: 'REPORT_SEARCH_INVALID' });
  await assert.rejects(searchWeb('事件', { key: 'x', fetchImpl: response({ results: [{ ...result, date: undefined }] }) }), { code: 'REPORT_SEARCH_INVALID' });
});
test('fetch only accepts public HTTP(S) document URLs and actual page content', async () => {
  for (const url of ['file:///etc/passwd', 'http://127.0.0.1/a', 'https://[::1]/', 'http://localhost/',
    'http://10.0.0.1/', 'https://user:pass@example.org', 'https://host.local/a', 'https://example.org:9000']) assert.equal(safeSourceUrl(url), null);
  assert.equal(safeSourceUrl('https://example.org/a#section'), 'https://example.org/a');
  assert.deepEqual(sourceUrlsIn('来源：https://example.org/a。 https://example.org/a'), ['https://example.org/a']);
  await assert.rejects(fetchPage('https://example.org', { key: 'x', fetchImpl: response({ title: '页', content: '' }) }), { code: 'REPORT_FETCH_INVALID' });
  assert.equal((await fetchPage('https://example.org', { key: 'x', fetchImpl: response({ title: '', content: '内容' }) })).content, '内容');
});
test('model state depends on completed status, not presence of text', async () => {
  const output = [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"queries":[]}' }] }];
  const args = { instructions: '规则', input: {}, schema: {}, name: 'test' };
  await assert.rejects(generateStructured(args, { key: 'x', fetchImpl: response({ status: 'incomplete', output }) }), { code: 'REPORT_AI_INCOMPLETE' });
  assert.deepEqual(await generateStructured(args, { key: 'x', fetchImpl: response({ status: 'completed', output }) }), { queries: [] });
});
test('provider errors and cancellation are surfaced instead of empty evidence', async () => {
  await assert.rejects(searchWeb('新闻', { key: 'x', fetchImpl: async () => new Response('', { status: 402 }) }), { code: 'REPORT_PROVIDER_BALANCE' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchPage('https://example.org', { key: 'x', signal: controller.signal,
    fetchImpl: async (_, options) => { options.signal.throwIfAborted(); } }), { code: 'REPORT_CANCELLED' });
});
test('HTTP 201/202 cannot be promoted to success by a plausible payload', async () => {
  const output = [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"queries":[]}' }] }];
  for (const status of [201, 202]) {
    await assert.rejects(searchWeb('新闻', { key: 'x', fetchImpl: async () => Response.json({ results: [result] }, { status }) }),
      { code: 'REPORT_PROVIDER_FAILED' });
    await assert.rejects(fetchPage('https://example.org', { key: 'x', fetchImpl: async () => Response.json({ title: '正文', content: '内容' }, { status }) }),
      { code: 'REPORT_PROVIDER_FAILED' });
    await assert.rejects(generateStructured({ instructions: '规则', input: {}, schema: {}, name: 'test' },
      { key: 'x', fetchImpl: async () => Response.json({ status: 'completed', output }, { status }) }), { code: 'REPORT_PROVIDER_FAILED' });
  }
});
test('research plan is bounded and never inferred from other fields', async () => {
  assert.deepEqual(await planResearch({ title: '日报', original: {} }, { generate: async () => ({ queries: ['主题', '主题'] }) }), ['主题']);
  await assert.rejects(planResearch({}, { generate: async () => ({ search: ['主题'] }) }), { code: 'REPORT_PLAN_INVALID' });
});
test('body rejects invented citations, unlabelled paragraphs, and oversized speech', () => {
  const body = { intro: '本期概览', highlights: [{ text: '要点', sourceIds: ['known'] }],
    sections: [{ title: '事件', paragraphs: [{ text: '正文', kind: 'fact', sourceIds: ['known'] }] }], voiceScript: '摘要', notes: [] };
  assert.equal(validateBody(body, [{ id: 'known' }]).body.intro, '本期概览');
  assert.throws(() => validateBody(body, [{ id: 'different' }]), { code: 'REPORT_BODY_INVALID' });
  assert.throws(() => validateBody({ ...body, voiceScript: '字'.repeat(241) }, [{ id: 'known' }]), { code: 'REPORT_BODY_INVALID' });
  assert.throws(() => validateBody({ ...body, sections: [{ title: '事件', paragraphs: [{ text: '事实', sourceIds: [] }] }] }, [{ id: 'known' }]), { code: 'REPORT_BODY_INVALID' });
});
