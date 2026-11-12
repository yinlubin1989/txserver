const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export class NewsPresentationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** This is display formatting only: the sender's full text and links remain intact. */
export function formatNewsNotification(notification) {
  if (!notification || typeof notification !== 'object' || Array.isArray(notification)) {
    throw new NewsPresentationError('NEWS_INPUT_INVALID', '新闻内容格式无效。');
  }
  const fields = {};
  for (const [name, limit] of Object.entries({ title: 120, content: 3000, type: 40, time: 80 })) {
    const value = notification[name] === undefined && name !== 'content' ? '' : notification[name];
    if (typeof value !== 'string' || Array.from(value).length > limit || CONTROL_CHARACTERS.test(value)) {
      throw new NewsPresentationError('NEWS_INPUT_INVALID', '新闻字段或长度无效。');
    }
    fields[name] = value.replace(/\r\n?/gu, '\n').trim();
  }
  if (!fields.content) throw new NewsPresentationError('NEWS_INPUT_INVALID', '新闻正文不能为空。');
  const title = fields.title.replace(/^【grokbot】\s*/iu, '').trim() || '新闻简报';
  const metadata = [fields.type, fields.time].filter(Boolean).join(' · ');
  return {
    ...fields, title, metadata,
    text: [`GROKBOT · ${title}`, metadata, fields.content].filter(Boolean).join('\n\n'),
  };
}
