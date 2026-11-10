import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { unavailable } from './errors';
import { validateRecord } from './validation';
import type { CloudMessage, EncryptedPayload, StoredMessage } from './types';

export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const contentHash = (record: CloudMessage) => hashToken(canonical(record));
export function encryptionKey(): Buffer {
  const value = process.env.PANGHU_ARCHIVE_ENCRYPTION_KEY;
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw unavailable();
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) throw unavailable();
  return key;
}
type Binding = Omit<StoredMessage, 'record'> & { id: string };
function associatedData(binding: Binding): Buffer {
  return Buffer.from(JSON.stringify(['panghu-archive-v1', binding.ownerHash, binding.id, binding.archivedAt, binding.contentHash]));
}
export function encryptRecord(record: CloudMessage, binding: Binding, key: Buffer): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(associatedData(binding));
  const data = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
export function decryptRecord(payload: EncryptedPayload, binding: Binding, key: Buffer): CloudMessage {
  try {
    if (payload.version !== 1) throw new Error();
    const iv = Buffer.from(payload.iv, 'base64'); const tag = Buffer.from(payload.tag, 'base64');
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const cipher = createDecipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(associatedData(binding)); cipher.setAuthTag(tag);
    const record = validateRecord(JSON.parse(Buffer.concat([cipher.update(Buffer.from(payload.data, 'base64')), cipher.final()]).toString('utf8')));
    if (record.id !== binding.id || contentHash(record) !== binding.contentHash) throw new Error();
    return record;
  } catch { throw unavailable(); }
}
