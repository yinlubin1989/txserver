import { ArchiveError } from './errors';

export type RequestKind = 'session' | 'read' | 'write' | 'admin-login' | 'admin-read' | 'admin-logout' | 'admin-write';
type Counter = { count: number; expiresAt: number };
export function createLimiter() {
  const counters = new Map<string, Counter>();
  function take(key: string, limit: number, expiresAt: number, now: number) {
    let entry = counters.get(key);
    if (!entry || entry.expiresAt <= now) {
      if (counters.size >= 10000) for (const [id, value] of counters) if (value.expiresAt <= now) counters.delete(id);
      if (counters.size >= 10000) throw new ArchiveError('RATE_LIMITED', '请求较多，请稍后重试。', 429);
      entry = { count: 0, expiresAt }; counters.set(key, entry);
    }
    if (entry.count >= limit) throw new ArchiveError('RATE_LIMITED', '操作太频繁，请稍后重试。', 429);
    entry.count++;
  }
  return (ip: string, kind: RequestKind, ownerHash = 'anonymous', now = Date.now()) => {
    const minute = Math.floor(now / 60000) * 60000 + 60000;
    const day = Math.floor(now / 86400000) * 86400000 + 86400000;
    take(`ip:${ip}`, 240, minute, now);
    if (kind === 'session') {
      take(`session:${ip}`, 10, day, now); take('session-global', 200, day, now);
    } else if (kind === 'write') {
      take(`write-minute:${ownerHash}`, 60, minute, now); take(`write-day:${ownerHash}`, 2000, day, now);
    } else if (kind === 'admin-login') {
      const quarter = Math.floor(now / 900000) * 900000 + 900000;
      take(`admin-login:${ip}`, 5, quarter, now); take('admin-login-global', 60, quarter, now);
    } else take(`read:${ownerHash}`, 120, minute, now);
  };
}
export const limitRequest = createLimiter();
