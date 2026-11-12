import { synthesizeNewsSpeech } from '../wechatNotify/news/speech.mjs';

/** Web reports have a longer short-form script; the old chat attachment limit remains unchanged. */
export async function synthesizeReportSpeech(text, options = {}) {
  return synthesizeNewsSpeech(text, { ...options, maxCharacters: 240 });
}
