import { createHash } from 'node:crypto';
import { LedgerError } from './errors';

// Only a server-verified code supplies identity. Never trust client-provided OpenID.
export async function wechatAccount(code: string, fetcher: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const appId = env.WECHAT_APP_ID;
  const secret = env.WECHAT_APP_SECRET;
  if (!appId || !secret) throw new LedgerError('WECHAT_NOT_CONFIGURED', '微信账本同步尚未配置，请联系开发者。', 503);
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.search = new URLSearchParams({ appid: appId, secret, js_code: code, grant_type: 'authorization_code' }).toString();
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(10000), cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error('upstream');
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('format');
    const data = value as Record<string, unknown>;
    // code2Session success may omit errcode; an explicit nonzero code is always failure.
    if (Object.hasOwn(data, 'errcode') && data.errcode !== 0) {
      if (data.errcode === 40029 || data.errcode === 40163) {
        throw new LedgerError('WECHAT_CODE_INVALID', '微信登录已过期，请重试。', 401);
      }
      throw new Error('upstream');
    }
    if (typeof data.openid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.openid) ||
        typeof data.session_key !== 'string' || !data.session_key) throw new Error('format');
    return createHash('sha256').update(JSON.stringify(['wechat', appId, data.openid])).digest('hex');
  } catch (error) {
    if (error instanceof LedgerError) throw error;
    // Never log the upstream URL, code, OpenID, session_key or AppSecret.
    throw new LedgerError('WECHAT_LOGIN_UNAVAILABLE', '微信登录暂时不可用，请稍后重试。', 503);
  }
}
