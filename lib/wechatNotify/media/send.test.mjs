import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createHash } from 'node:crypto';
import { sendImage, sendAudioFile } from './send.mjs';
import { postWechat } from '../transport.mjs';

const account = { recipient: 'owner', botToken: 'private-token' };
const context = { recipient: 'owner', contextToken: 'private-context' };
const png = Buffer.from('89504e470d0a1a0a000102030405060708', 'hex');
const audio = Buffer.from('ID3-test-audio');

function pipeline({ asset = png, type = 1, receipt = { ret: 0 }, uploadParameters, cdnResponse } = {}) {
  const calls = []; let key, metadata, message;
  const fetchImpl = async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/getuploadurl')) {
      assert.equal(options.headers.Authorization, 'Bearer private-token');
      metadata = JSON.parse(options.body);
      assert.equal(metadata.media_type, type);
      assert.equal(metadata.rawsize, asset.length);
      assert.equal(metadata.rawfilemd5, createHash('md5').update(asset).digest('hex'));
      assert.equal(metadata.no_need_thumb, true);
      assert.equal(metadata.to_user_id, 'owner');
      key = Buffer.from(metadata.aeskey, 'hex');
      return Response.json(uploadParameters ?? { upload_param: 'private-upload-param' });
    }
    if (url.startsWith('https://novac2c.cdn.weixin.qq.com/')) {
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.headers['Content-Type'], 'application/octet-stream');
      assert.equal(options.method, 'POST');
      assert.equal(options.body.length, metadata.filesize);
      const decipher = createDecipheriv('aes-128-ecb', key, null);
      assert.deepEqual(Buffer.concat([decipher.update(options.body), decipher.final()]), asset);
      return cdnResponse ? cdnResponse() : new Response(null, { status: 200, headers: { 'x-encrypted-param': 'private-download-param' } });
    }
    assert.equal(url, 'https://ilinkai.weixin.qq.com/ilink/bot/sendmessage');
    message = JSON.parse(options.body).msg;
    assert.equal(message.context_token, context.contextToken);
    assert.equal(message.to_user_id, account.recipient);
    assert.equal(message.message_type, 2);
    assert.equal(message.message_state, 2);
    assert.equal(message.item_list.length, 1);
    return Response.json(receipt);
  };
  return { fetchImpl, calls, get message() { return message; }, get metadata() { return metadata; } };
}

test('PNG uploads encrypted bytes and sends one image item with ciphertext length', async () => {
  const mock = pipeline();
  assert.deepEqual(await sendImage(account, context, { buffer: png }, 'image-id', mock), { status: 'accepted' });
  assert.equal(mock.calls.length, 3);
  const item = mock.message.item_list[0];
  assert.equal(item.type, 2);
  assert.equal(item.image_item.mid_size, mock.metadata.filesize);
  assert.equal(item.image_item.media.encrypt_query_param, 'private-download-param');
  assert.equal(Buffer.from(item.image_item.media.aes_key, 'base64').toString(), mock.metadata.aeskey);
  assert.equal(mock.message.client_id, 'image-id');
});

test('MP3 is one file attachment, never a claimed native voice bubble', async () => {
  const mock = pipeline({ asset: audio, type: 3, receipt: {} });
  assert.deepEqual(await sendAudioFile(account, context, { buffer: audio, fileName: 'muse-语音摘要.mp3' }, 'audio-id', mock),
    { status: 'submitted', deliveryStatus: 'unknown', acknowledgement: 'missing_business_status' });
  const item = mock.message.item_list[0];
  assert.equal(item.type, 4);
  assert.equal(item.file_item.file_name, 'muse-语音摘要.mp3');
  assert.equal(item.file_item.len, String(audio.length));
  assert.equal(mock.calls.length, 3);
});

test('full CDN upload URL takes documented precedence over upload_param', async () => {
  const full = 'https://novac2c.cdn.weixin.qq.com/c2c/upload?ticket=private';
  const mock = pipeline({ uploadParameters: { upload_full_url: full, upload_param: 'unused' } });
  await sendImage(account, context, { buffer: png }, 'id', mock);
  assert.equal(mock.calls[1], full);
});

test('unexpected upload hosts, credentials, protocols, and paths never receive media', async () => {
  for (const full of ['https://example.org/c2c/upload', 'http://novac2c.cdn.weixin.qq.com/c2c/upload',
    'https://user:pass@novac2c.cdn.weixin.qq.com/c2c/upload', 'https://novac2c.cdn.weixin.qq.com:8443/c2c/upload',
    'https://novac2c.cdn.weixin.qq.com/c2c/download', 'https://novac2c.cdn.weixin.qq.com/c2c/upload#fragment']) {
    const mock = pipeline({ uploadParameters: { upload_full_url: full, upload_param: 'valid-do-not-fallback' } });
    await assert.rejects(sendImage(account, context, { buffer: png }, 'id', mock), { code: 'WECHAT_UPLOAD_URL_INVALID' });
    assert.equal(mock.calls.length, 1);
  }
});

test('upload API only accepts its scoped response contract; send contract stays strict', async () => {
  for (const body of [{}, { ret: 0 }, { upload_param: 123 }, { upload_param: ' ' }, { upload_full_url: null, upload_param: 'x' }, { upload_param: 'x', ret: '0' }]) {
    await assert.rejects(postWechat('token', 'getuploadurl', {}, { fetchImpl: async () => Response.json(body) }), { code: 'WECHAT_INVALID_RESPONSE', outcome: 'failed' });
  }
  for (const body of [{ upload_param: 'x' }, { ret: 0, upload_param: 'x' }]) {
    assert.deepEqual(await postWechat('token', 'getuploadurl', {}, { fetchImpl: async () => Response.json(body) }), body);
  }
  await assert.rejects(postWechat('token', 'getuploadurl', {}, { fetchImpl: async () => Response.json({ ret: -2, upload_param: 'x' }) }), { code: 'WECHAT_REJECTED' });
  await assert.rejects(postWechat('token', 'sendmessage', {}, { fetchImpl: async () => Response.json({ upload_param: 'x' }) }), { code: 'WECHAT_INVALID_RESPONSE', outcome: 'unknown' });
});

test('CDN missing header, non-200, network failure never submit a message or retry', async () => {
  for (const cdnResponse of [() => new Response(null), () => new Response(null, { status: 201, headers: { 'x-encrypted-param': 'x' } }),
    () => new Response(null, { status: 503 }), () => { throw new Error('private URL'); }]) {
    const mock = pipeline({ cdnResponse });
    await assert.rejects(sendImage(account, context, { buffer: png }, 'id', mock), error => {
      assert.equal(error.code, 'WECHAT_UPLOAD_FAILED');
      assert.equal(error.outcome, 'failed');
      assert.ok(!error.message.includes('private'));
      return true;
    });
    assert.equal(mock.calls.length, 2);
  }
});

test('uncertain final send is never retried or converted into accepted', async () => {
  const mock = pipeline({ receipt: { message_id: '17' } });
  await assert.rejects(sendImage(account, context, { buffer: png }, 'id', mock), { code: 'WECHAT_INVALID_RESPONSE', outcome: 'unknown' });
  assert.equal(mock.calls.length, 3);
});

test('invalid session, media, and filenames fail before network activity', async () => {
  const options = { fetchImpl: () => { throw new Error('must not fetch'); } };
  await assert.rejects(sendImage(account, { recipient: 'other', contextToken: 'x' }, { buffer: png }, 'id', options), { code: 'CONTEXT_REQUIRED' });
  await assert.rejects(sendImage(account, context, { buffer: Buffer.from('not image') }, 'id', options), { code: 'INVALID_MEDIA' });
  for (const fileName of ['../test.mp3', 'x\n.mp3', 'wrong.wav']) {
    await assert.rejects(sendAudioFile(account, context, { buffer: audio, fileName }, 'id', options), { code: 'INVALID_MEDIA' });
  }
  await assert.rejects(sendAudioFile(account, context, { buffer: Buffer.alloc(5 * 1024 * 1024 + 1), fileName: 'large.mp3' }, 'id', options), { code: 'INVALID_MEDIA' });
});

test('CDN timeout is bounded and prevents the final send', async () => {
  const mock = pipeline(); let calls = 0;
  const fetchImpl = (url, options) => {
    calls++;
    if (url.endsWith('/getuploadurl')) return mock.fetchImpl(url, options);
    return new Promise((resolve, reject) => {
      if (options.signal.aborted) reject(new Error('aborted'));
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  };
  await assert.rejects(sendImage(account, context, { buffer: png }, 'id', { fetchImpl, uploadTimeoutMs: 10 }), { code: 'WECHAT_UPLOAD_TIMEOUT', outcome: 'failed' });
  assert.equal(calls, 2);
});
