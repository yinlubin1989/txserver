import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from '../financeStatistics/testLoader.mjs';

const { isArchiveDay } = loadModule('../chatMemories/archive.ts');
const message = { id: 14, day: '2025-08-07', clock: '07:02', kind: 'text', sender: 'peer', body: '虚构测试：我把你的伞放在门边了。' };
const data = {
  stats: { messages: 6, text: 5, voice: 1, calls: 0, me: 3, peer: 3, days: 1, firstDay: message.day, lastDay: message.day },
  samples: [message], anchorIds: [message.id],
  keywordCounts: [], byKind: [], scope: { matchedMessages: 5, sampledMessages: 1, complete: true },
};
const query = { startDay: null, endDay: null, sender: null, keywords: ['伞'], includeExcerpts: true, includeConversationStats: false };
const paragraph = { basis: 'messages', text: '阿雯提早放好了伞，可以理解为日常的照顾。', ids: [14] };
function response(value) {
  return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
}

function mockQuestion(t, plan, answer, read = () => data) {
  const { askQuestion } = loadModule('../chatMemories/question.ts', { './archive': { getQuestionEvidence: read, isArchiveDay } });
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-only';
  t.after(() => { if (previous === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previous; });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const payload = JSON.parse(options.body);
    requests.push(JSON.parse(payload.input[0].content));
    assert.deepEqual(payload.tools, []);
    assert.equal(payload.store, false);
    return requests.length === 1 ? response(plan) : response(answer);
  });
  return { askQuestion, requests };
}

test('可核对的逐段引用由检索到的原文生成，首轮只有问题和日期', async t => {
  const { askQuestion, requests } = mockQuestion(t, { queries: [query] }, { paragraphs: [paragraph] }, args => {
    assert.deepEqual(args.keywords, ['伞']);
    return data;
  });
  const result = await askQuestion('双方通过哪些举动表达关心？');
  assert.equal(requests.length, 2);
  assert.deepEqual(Object.keys(requests[0]).sort(), ['question', 'today']);
  assert.equal(requests[1].evidence[0].excerpts[0].body, message.body);
  assert.deepEqual(result.sources, [message]);
  assert.match(result.answer, /〔#14〕/);
});

test('纯数量问题只把筛选统计发送给模型', async t => {
  const { askQuestion, requests } = mockQuestion(t, { queries: [{ ...query, keywords: [], includeExcerpts: false }] },
    { paragraphs: [{ basis: 'statistics', text: '该日共发了 6 条消息。', ids: [] }] });
  assert.deepEqual((await askQuestion('有多少条？')).sources, []);
  assert.deepEqual(requests[1].evidence[0].excerpts, []);
  assert.ok(!JSON.stringify(requests[1]).includes(message.body));
});

test('拒绝样本以外的引用，拒绝没有来源的原文分析', async t => {
  for (const ids of [[999], []]) {
    await t.test(JSON.stringify(ids), async sub => {
      const { askQuestion } = mockQuestion(sub, { queries: [query] }, { paragraphs: [{ ...paragraph, ids }] });
      await assert.rejects(askQuestion('谁带了伞？'), { code: 'INVALID_MODEL_OUTPUT' });
    });
  }
});

test('无效日期不发起归档检索，不突破日期限制', async t => {
  const { askQuestion, requests } = mockQuestion(t, { queries: [{ ...query, startDay: '2025-02-29' }] }, {},
    () => { assert.fail('must not touch the archive'); });
  await assert.rejects(askQuestion('那天发生了什么？'), { code: 'INVALID_MODEL_OUTPUT' });
  assert.equal(requests.length, 1);
});
