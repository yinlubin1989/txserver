import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WechatTransportError } from './transport.mjs';

const MAX_CONFIG_BYTES = 1024 * 1024;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const invalid = () => new WechatTransportError('CHANNEL_CONFIG_INVALID', '微信通道配置无效，请检查服务端配置。', 503);

export function getStateDirectory() {
  const directory = process.env.WECHAT_NOTIFY_STATE_DIR || '/root/.txserver-wechat';
  if (!path.isAbsolute(directory)) throw invalid();
  return directory;
}

async function readJson(directory, filename) {
  let raw;
  try { raw = await readFile(path.join(directory, filename)); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw invalid();
  }
  if (raw.length > MAX_CONFIG_BYTES) throw invalid();
  try { return JSON.parse(raw.toString('utf8')); } catch { throw invalid(); }
}

export async function readCredentials(directory) {
  const value = await readJson(directory, 'credentials.json');
  if (value === null) throw new WechatTransportError('CHANNEL_NOT_CONFIGURED', '微信机器人尚未配置。', 503);
  if (!value || !nonempty(value.botToken) || !nonempty(value.recipient) || /[\r\n]/u.test(value.botToken)) throw invalid();
  return { botToken: value.botToken, recipient: value.recipient };
}

export async function readContext(directory) {
  const value = await readJson(directory, 'context.json');
  // A new channel has no inbound conversation yet. Missing files are an explicit unbound state.
  if (value === null) return { recipient: '', contextToken: '', cursor: '', updatedAt: null };
  if (!value || typeof value.recipient !== 'string' || typeof value.contextToken !== 'string' ||
      typeof value.cursor !== 'string' || !(value.updatedAt === null ||
        (typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))))) throw invalid();
  return { recipient: value.recipient, contextToken: value.contextToken, cursor: value.cursor, updatedAt: value.updatedAt };
}

export async function atomicWriteJson(directory, filename, value) {
  if (path.basename(filename) !== filename || filename === '.' || filename === '..') throw invalid();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${filename}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temporary, path.join(directory, filename));
    const parent = await open(directory, 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
