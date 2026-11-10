import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { hashToken } from './crypto';
import { unavailable } from './errors';
import { validateAccountName } from './validation';
import type { AccountName, EncryptedPayload } from './types';

type Binding = { profileHash: string; updatedAt: string };
function associatedData(binding: Binding) { return Buffer.from(JSON.stringify(['panghu-archive-account-note-v1', binding.profileHash, binding.updatedAt])); }
export function encryptAccountName(value: AccountName, binding: Binding, key: Buffer): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(associatedData(binding));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
export function decryptAccountName(payload: EncryptedPayload, binding: Binding, key: Buffer): AccountName {
  try {
    if (payload.version !== 1) throw new Error();
    const iv = Buffer.from(payload.iv, 'base64'); const tag = Buffer.from(payload.tag, 'base64');
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const cipher = createDecipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(associatedData(binding)); cipher.setAuthTag(tag);
    const value = validateAccountName(JSON.parse(Buffer.concat([cipher.update(Buffer.from(payload.data, 'base64')), cipher.final()]).toString('utf8')));
    if (value.displayName === null || hashToken(value.profile) !== binding.profileHash) throw new Error();
    return value;
  } catch { throw unavailable(); }
}
