import { access } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { formatNewsNotification, NewsPresentationError } from './presentation.mjs';

const WIDTH = 1080, MARGIN = 72, CONTENT_WIDTH = WIDTH - MARGIN * 2;
const MAX_HEIGHT = 12000, MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const INK = '#18201f', MUTED = '#69716f';

function escapeMarkup(value) {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;').replace(/'/gu, '&apos;');
}

/** PNG bulletin, rendered entirely in memory. Requires a deployed Chinese font. */
export async function renderNewsImage(notification, {
  fontPath = process.env.WECHAT_NEWS_FONT_PATH,
  fontFamily = 'Noto Sans CJK SC',
} = {}) {
  const news = formatNewsNotification(notification);
  if (typeof fontPath !== 'string' || !path.isAbsolute(fontPath)) {
    throw new NewsPresentationError('NEWS_FONT_NOT_CONFIGURED', '新闻图片的中文字体尚未配置。');
  }
  try { await access(fontPath); }
  catch { throw new NewsPresentationError('NEWS_FONT_NOT_CONFIGURED', '新闻图片的中文字体不可用。'); }
  // A pathological line-per-character input must not allocate an unbounded image.
  if (news.content.split('\n').length > 160) {
    throw new NewsPresentationError('NEWS_LAYOUT_TOO_LARGE', '新闻换行过多，无法生成完整阅读图片。');
  }
  const layers = [];
  let cursor = 68;
  async function text(value, { size = 38, bold = false, color = INK, spacing = 16, width = CONTENT_WIDTH, left = MARGIN, top } = {}) {
    const markup = `<span foreground="${color}"${bold ? ' weight="bold"' : ''}>${escapeMarkup(value)}</span>`;
    const { data, info } = await sharp({ text: {
      text: markup, font: `${fontFamily} ${size}`, fontfile: fontPath, width,
      wrap: 'word-char', rgba: true, dpi: 72, spacing,
    } }).png().toBuffer({ resolveWithObject: true });
    const y = top ?? cursor;
    if (y + info.height > MAX_HEIGHT - 180) throw new NewsPresentationError('NEWS_LAYOUT_TOO_LARGE', '新闻排版过长，无法生成完整阅读图片。');
    layers.push({ input: data, top: y, left });
    if (top === undefined) cursor += info.height;
    return info;
  }
  function line(top, color = '#dce1df', thickness = 2) {
    layers.push({ input: { create: { width: CONTENT_WIDTH, height: thickness, channels: 4, background: color } }, top, left: MARGIN });
  }
  try {
    await text('GROKBOT', { size: 34, bold: true, spacing: 0 });
    await text('NEWS BRIEF', { size: 22, color: MUTED, width: 230, left: WIDTH - MARGIN - 230, top: 78, spacing: 0 });
    cursor += 38;
    line(cursor, INK, 3);
    cursor += 48;
    await text(news.title, { size: 60, bold: true, spacing: 18 });
    if (news.metadata) {
      cursor += 28;
      await text(news.metadata, { size: 26, color: MUTED, spacing: 8 });
    }
    cursor += 44;
    line(cursor);
    cursor += 42;
    await text(news.content, { size: 38, spacing: 18 });
    cursor += 48;
    line(cursor);
    cursor += 26;
    await text('GROKBOT 提供内容 · 原文与链接亦见文字消息', { size: 23, color: MUTED, spacing: 8 });
    const height = cursor + 62;
    const buffer = await sharp({ create: { width: WIDTH, height, channels: 3, background: '#ffffff' } })
      .composite(layers).removeAlpha().png({ compressionLevel: 7 }).toBuffer();
    if (buffer.length > MAX_IMAGE_BYTES) throw new NewsPresentationError('NEWS_IMAGE_TOO_LARGE', '新闻图片超过大小限制。');
    return { buffer, width: WIDTH, height, mimeType: 'image/png' };
  } catch (error) {
    if (error instanceof NewsPresentationError) throw error;
    throw new NewsPresentationError('NEWS_RENDER_FAILED', '新闻图片生成失败。');
  }
}
