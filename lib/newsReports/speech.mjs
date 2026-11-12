import { synthesizeNewsSpeech } from '../wechatNotify/news/speech.mjs';

export async function synthesizeNarrationSpeech(text, options = {}) {
  return synthesizeNewsSpeech(text, { ...options, maxCharacters: 3000, maxBytes: 8 * 1024 * 1024, timeoutMs: 90000 });
}
