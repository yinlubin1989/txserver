import { sendText } from '../transport.mjs';
import { sendImage, sendAudioFile } from '../media/send.mjs';
import { formatNewsNotification } from './presentation.mjs';
import { renderNewsImage } from './renderImage.mjs';
import { summarizeNews } from './summary.mjs';
import { synthesizeNewsSpeech } from './speech.mjs';

const errorCode = error => /^(NEWS_|AI_|WECHAT_|MEDIA_|CONTEXT_)[A-Z_]+$/u.test(error?.code || '') ? error.code : 'NEWS_UNAVAILABLE';
const validReceipt = receipt => receipt?.status === 'accepted' || (receipt?.status === 'submitted' &&
  receipt.deliveryStatus === 'unknown' && receipt.acknowledgement === 'missing_business_status');

export function aggregateDelivery(parts) {
  const states = Object.values(parts).map(part => part.status);
  if (states.includes('unknown')) return 'unknown';
  if (states.every(state => state === 'accepted')) return 'accepted';
  if (states.every(state => state === 'accepted' || state === 'submitted')) return 'submitted';
  if (states.some(state => state === 'accepted' || state === 'submitted')) return 'partial';
  return 'failed';
}

/** Each message is checkpointed before sending; a retry never repeats a partially sent bundle. */
export async function deliverNews(notification, requestId, { account, context, checkpoint, signal,
  render = renderNewsImage, summarize = summarizeNews, speak = synthesizeNewsSpeech,
  imageSend = sendImage, textSend = sendText, audioSend = sendAudioFile,
  audioMode = process.env.WECHAT_NEWS_AUDIO_MODE || 'native' } = {}) {
  const parts = { image: { status: 'not_started' }, text: { status: 'not_started' }, audio: { status: 'not_started' } };
  const prepared = await Promise.allSettled([
    render(notification),
    audioMode === 'file' ? summarize(notification, { signal }).then(text => speak(text, { signal })) :
      Promise.reject(Object.assign(new Error('NEWS_NATIVE_VOICE_UNAVAILABLE'), { code: 'NEWS_NATIVE_VOICE_UNAVAILABLE' })),
  ]);
  const image = prepared[0], audio = prepared[1];
  if (image.status === 'rejected') parts.image = { status: 'failed', code: errorCode(image.reason), stage: 'preparation' };
  if (audio.status === 'rejected') parts.audio = { status: 'failed', code: errorCode(audio.reason), stage: 'preparation' };
  let text = formatNewsNotification(notification).text;
  if (audio.status === 'rejected') text += audioMode === 'file' ? '\n\n语音摘要暂时不可用，本条保留完整文字。' :
    '\n\n微信原生语音暂不可用，本条仅发送图文。';
  const tasks = [
    ['image', () => imageSend(account, context, { buffer: image.value.buffer }, `${requestId}-image`, { signal })],
    ['text', () => textSend(account, context, text, `${requestId}-text`, { signal })],
    ['audio', () => audioSend(account, context, { buffer: audio.value, fileName: 'grokbot-新闻摘要.mp3' }, `${requestId}-audio`, { signal })],
  ];
  await checkpoint(parts);
  for (const [name, send] of tasks) {
    if (parts[name].status === 'failed') continue;
    if (signal?.aborted) { parts[name] = { status: 'failed', code: 'NEWS_CANCELLED', stage: 'before_send' }; continue; }
    parts[name] = { status: 'sending' };
    await checkpoint(parts); // If this write fails, do not make the external side effect.
    try {
      const receipt = await send();
      parts[name] = validReceipt(receipt) ? { ...receipt } : { status: 'unknown', code: 'NEWS_SEND_UNCONFIRMED' };
    } catch (error) {
      parts[name] = { status: error.outcome === 'failed' ? 'failed' : 'unknown', code: errorCode(error) };
    }
    await checkpoint(parts);
  }
  return { status: aggregateDelivery(parts), parts };
}
