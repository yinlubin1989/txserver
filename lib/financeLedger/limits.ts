import { LedgerError } from './errors';

type Counter = { count: number; expiresAt: number };
const counters = new Map<string, Counter>();
const MAX_COUNTERS = 10000;
function configured(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
function take(key: string, limit: number, expiresAt: number, now: number) {
  let counter = counters.get(key);
  if (!counter || counter.expiresAt <= now) {
    if (counters.size >= MAX_COUNTERS) for (const [storedKey, entry] of counters) if (entry.expiresAt <= now) counters.delete(storedKey);
    if (counters.size >= MAX_COUNTERS) throw new LedgerError('RATE_LIMITED', '请求较多，请稍后重试。', 429);
    counter = { count: 0, expiresAt }; counters.set(key, counter);
  }
  if (counter.count >= limit) throw new LedgerError('RATE_LIMITED', '操作太频繁，请稍后重试。', 429);
  counter.count++;
}
export function limitRequest(ip: string, kind: 'session' | 'login' | 'read' | 'write', ownerHash = '', now = Date.now()) {
  const minute = Math.floor(now / 60000) * 60000 + 60000;
  const midnight = Math.floor((now + 8 * 3600000) / 86400000) * 86400000 + 86400000 - 8 * 3600000;
  take(`ip:${ip}`, configured('FINANCE_LEDGER_IP_MINUTE_LIMIT', 120), minute, now);
  if (kind === 'session') {
    take(`session:${ip}`, configured('FINANCE_LEDGER_SESSION_IP_DAILY_LIMIT', 20), midnight, now);
    take('session-global', configured('FINANCE_LEDGER_SESSION_DAILY_LIMIT', 200), midnight, now);
  } else if (kind === 'login') {
    take(`login:${ip}`, configured('FINANCE_LEDGER_LOGIN_IP_DAILY_LIMIT', 200), midnight, now);
    take('login-global', configured('FINANCE_LEDGER_LOGIN_DAILY_LIMIT', 2000), midnight, now);
  } else if (kind === 'write') {
    take(`write-minute:${ownerHash}`, configured('FINANCE_LEDGER_WRITE_MINUTE_LIMIT', 30), minute, now);
    take(`write-day:${ownerHash}`, configured('FINANCE_LEDGER_WRITE_DAILY_LIMIT', 200), midnight, now);
  }
}
