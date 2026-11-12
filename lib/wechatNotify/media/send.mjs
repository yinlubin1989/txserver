import { postWechat, WechatTransportError } from '../transport.mjs';
import { uploadMedia } from './upload.mjs';

function validateSession(account, context, clientId) {
  if (!account?.recipient || context?.recipient !== account.recipient || !context.contextToken) {
    throw new WechatTransportError('CONTEXT_REQUIRED', '请先在微信里给机器人发一条消息，再重新调用。', 409);
  }
  if (typeof clientId !== 'string' || !clientId || clientId.length > 256 || /[\u0000-\u001f\u007f]/u.test(clientId)) {
    throw new WechatTransportError('INVALID_MESSAGE', '消息请求标识无效。', 400);
  }
}

async function sendItem(account, context, item, clientId, options) {
  const receipt = await postWechat(account.botToken, 'sendmessage', { msg: {
    from_user_id: '', to_user_id: account.recipient, client_id: clientId,
    message_type: 2, message_state: 2, item_list: [item], context_token: context.contextToken,
  } }, options);
  return receipt.ret === 0 ? { status: 'accepted' } :
    { status: 'submitted', deliveryStatus: 'unknown', acknowledgement: 'missing_business_status' };
}

export async function sendImage(account, context, { buffer }, clientId, options = {}) {
  validateSession(account, context, clientId);
  const png = Buffer.isBuffer(buffer) && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const jpeg = Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if ((!png && !jpeg) || buffer.length > 8 * 1024 * 1024) throw new WechatTransportError('INVALID_MEDIA', '图片需为不超过 8 MB 的 PNG 或 JPEG。', 400);
  const uploaded = await uploadMedia(account, buffer, 1, options);
  return sendItem(account, context, { type: 2, image_item: { media: uploaded.media, mid_size: uploaded.encryptedSize } }, clientId, options);
}

/** Deliberately a FILE item: Tencent has not established outbound voice-bubble support. */
export async function sendAudioFile(account, context, { buffer, fileName }, clientId, options = {}) {
  validateSession(account, context, clientId);
  const mp3 = Buffer.isBuffer(buffer) && buffer.length >= 3 &&
    (buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0));
  if (!mp3 || buffer.length > 5 * 1024 * 1024 || typeof fileName !== 'string' || !fileName.endsWith('.mp3') ||
      Array.from(fileName).length > 120 || /[\/\\\u0000-\u001f\u007f]/u.test(fileName)) {
    throw new WechatTransportError('INVALID_MEDIA', '语音摘要需为不超过 5 MB 的 MP3 文件。', 400);
  }
  const uploaded = await uploadMedia(account, buffer, 3, options);
  return sendItem(account, context, { type: 4, file_item: { media: uploaded.media, file_name: fileName, len: String(uploaded.size) } }, clientId, options);
}
