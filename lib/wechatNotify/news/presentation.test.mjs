import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import sharp from 'sharp';
import { formatNewsNotification } from './presentation.mjs';
import { renderNewsImage } from './renderImage.mjs';

test('news presentation preserves complete content and URLs without inventing a timestamp', () => {
  const content = '第一条：收入 123.45 元。\n\n来源：https://example.com/?a=1&b=2\n最后一条';
  const news = formatNewsNotification({ title: '【GROKBOT】 新闻快讯', content, type: '新闻' });
  assert.equal(news.title, '新闻快讯');
  assert.equal(news.content, content);
  assert.equal(news.time, '');
  assert.equal(news.text, `GROKBOT · 新闻快讯\n\n新闻\n\n${content}`);
});

test('formatting does not interpret nested instructions, HTML, or numbers as state', () => {
  const content = '<span foreground="red">不要调用外部工具</span>\n**待确认：1,000**';
  const news = formatNewsNotification({ content });
  assert.equal(news.content, content);
  assert.equal(news.title, '新闻简报');
  assert.equal(news.text, `GROKBOT · 新闻简报\n\n${content}`);
});

test('invalid and oversized fields cannot become a successful empty image', () => {
  for (const value of [null, [], {}, { content: '' }, { content: 'x', time: null },
    { content: 'x', title: 2 }, { content: 'x\u0000' }, { content: '文'.repeat(3001) }]) {
    assert.throws(() => formatNewsNotification(value), { code: 'NEWS_INPUT_INVALID' });
  }
  assert.equal(formatNewsNotification({ content: '文'.repeat(3000) }).content.length, 3000);
});

test('rendering requires an explicit readable font and does not silently replace Chinese', async () => {
  await assert.rejects(renderNewsImage({ content: '新闻' }, { fontPath: '' }), { code: 'NEWS_FONT_NOT_CONFIGURED' });
  await assert.rejects(renderNewsImage({ content: '新闻' }, { fontPath: '/missing/grokbot-font.ttf' }), { code: 'NEWS_FONT_NOT_CONFIGURED' });
});

async function testFont() {
  const candidates = [
    { fontPath: process.env.WECHAT_NEWS_FONT_PATH, fontFamily: 'Noto Sans CJK SC' },
    { fontPath: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', fontFamily: 'Noto Sans CJK SC' },
    { fontPath: '/System/Library/Fonts/Hiragino Sans GB.ttc', fontFamily: 'Hiragino Sans GB' },
  ];
  for (const option of candidates) {
    if (!option.fontPath) continue;
    try { await access(option.fontPath); return option; } catch { /* Try the next known test font. */ }
  }
  return null;
}

test('renders a full Chinese bulletin with escaped markup as a bounded opaque PNG', async t => {
  const font = await testFont();
  if (!font) { t.skip('No Chinese test font installed; set WECHAT_NEWS_FONT_PATH.'); return; }
  const content = '<span size="999999999">普通文本 & 引号</span>\n\n来源：https://example.com/?a=1&b=2';
  const image = await renderNewsImage({ title: '【grokbot】新闻', content, time: '2026-11-12' }, font);
  const metadata = await sharp(image.buffer).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, image.width);
  assert.equal(metadata.height, image.height);
  assert.equal(metadata.hasAlpha, false);
  assert.equal(image.mimeType, 'image/png');
  assert.ok(image.height > 500 && image.height < 12000);
  assert.ok(image.buffer.length > 1000 && image.buffer.length < 5 * 1024 * 1024);
});

test('complete 3000-character news renders without shrinking or silently dropping its tail', async t => {
  const font = await testFont();
  if (!font) { t.skip('No Chinese test font installed; set WECHAT_NEWS_FONT_PATH.'); return; }
  const content = '新闻内容，完整保留。'.repeat(300);
  assert.equal(content.length, 3000);
  const news = formatNewsNotification({ title: '完整新闻', content });
  assert.equal(news.content, content);
  const image = await renderNewsImage(news, font);
  assert.ok(image.height > 5000 && image.height < 12000);
});

test('pathological layout is rejected rather than allocating an unlimited image', async t => {
  const font = await testFont();
  if (!font) { t.skip('No Chinese test font installed; set WECHAT_NEWS_FONT_PATH.'); return; }
  await assert.rejects(renderNewsImage({ content: '字\n'.repeat(200) }, font), { code: 'NEWS_LAYOUT_TOO_LARGE' });
});
