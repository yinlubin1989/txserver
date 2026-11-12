import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { postWechat, WechatTransportError } from '../transport.mjs';

const CDN_HOST = 'novac2c.cdn.weixin.qq.com';

function uploadUrl(parameters, filekey) {
  let url;
  try {
    // Same precedence and construction as Tencent's cdn-url.ts. Only their known
    // HTTPS upload host is accepted; a token must never redirect a server request.
    url = parameters.upload_full_url ? new URL(parameters.upload_full_url) :
      new URL(`https://${CDN_HOST}/c2c/upload?encrypted_query_param=${encodeURIComponent(parameters.upload_param)}&filekey=${filekey}`);
  } catch { throw new WechatTransportError('WECHAT_UPLOAD_URL_INVALID', '微信媒体上传地址无效。'); }
  if (url.protocol !== 'https:' || url.hostname !== CDN_HOST || url.port || url.username || url.password ||
      url.hash || url.pathname !== '/c2c/upload') {
    throw new WechatTransportError('WECHAT_UPLOAD_URL_INVALID', '微信媒体上传地址不受支持。');
  }
  return url.href;
}

/** Encrypt a bounded, in-memory asset and upload once. An upload is not a send. */
export async function uploadMedia(account, buffer, mediaType, { fetchImpl = globalThis.fetch,
  signal, timeoutMs = 15000, uploadTimeoutMs = 20000 } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 8 * 1024 * 1024 || ![1, 3].includes(mediaType)) {
    throw new WechatTransportError('INVALID_MEDIA', '媒体内容无效或超过大小限制。', 400);
  }
  const key = randomBytes(16), filekey = randomBytes(16).toString('hex');
  const cipher = createCipheriv('aes-128-ecb', key, null);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const parameters = await postWechat(account.botToken, 'getuploadurl', {
    filekey, media_type: mediaType, to_user_id: account.recipient, rawsize: buffer.length,
    rawfilemd5: createHash('md5').update(buffer).digest('hex'), filesize: ciphertext.length,
    no_need_thumb: true, aeskey: key.toString('hex'),
  }, { fetchImpl, signal, timeoutMs });
  const url = uploadUrl(parameters, filekey);
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, uploadTimeoutMs);
  try {
    if (controller.signal.aborted) throw new WechatTransportError('WECHAT_UPLOAD_TIMEOUT', '微信媒体上传已取消或超时。');
    const response = await fetchImpl(url, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/octet-stream' }, body: ciphertext,
    });
    const downloadParam = response.headers.get('x-encrypted-param');
    await response.body?.cancel().catch(() => {});
    if (response.status !== 200 || !downloadParam || downloadParam.length > 8192 || /[\u0000-\u0020\u007f]/u.test(downloadParam)) {
      throw new WechatTransportError('WECHAT_UPLOAD_FAILED', '微信媒体上传未完成。');
    }
    return {
      // Current Tencent image/file senders base64-encode the ASCII hex key.
      media: { encrypt_query_param: downloadParam, aes_key: Buffer.from(key.toString('hex')).toString('base64'), encrypt_type: 1 },
      size: buffer.length, encryptedSize: ciphertext.length,
    };
  } catch (error) {
    if (error instanceof WechatTransportError) throw error;
    throw new WechatTransportError(controller.signal.aborted ? 'WECHAT_UPLOAD_TIMEOUT' : 'WECHAT_UPLOAD_FAILED', '微信媒体上传未完成。');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
