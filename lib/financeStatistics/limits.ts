import { FinanceError } from './ledger';
type Counter = { day: string; daily: number; minute: number; count: number };
type State = { day: string; daily: number; active: number; clients: Map<string, Counter> };
const globalState = globalThis as typeof globalThis & { financeLimits?: State };
function limit(name: string, fallback: number) { const value = Number(process.env[name]); return Number.isSafeInteger(value) && value > 0 ? value : fallback; }
export function reserveCall(ip: string, now = Date.now()) {
  const day = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  const minute = Math.floor(now / 60000);
  const state = globalState.financeLimits ??= { day, daily: 0, active: 0, clients: new Map() };
  if (state.day !== day) { state.day = day; state.daily = 0; state.clients.clear(); }
  const client = state.clients.get(ip) ?? { day, daily: 0, minute, count: 0 };
  if (client.minute !== minute) { client.minute = minute; client.count = 0; }
  if (state.active >= limit('FINANCE_MAX_CONCURRENT', 2) || state.daily >= limit('FINANCE_DAILY_LIMIT', 100) || client.daily >= limit('FINANCE_IP_DAILY_LIMIT', 20) || client.count >= limit('FINANCE_IP_MINUTE_LIMIT', 3)) throw new FinanceError('RATE_LIMITED', '统计请求较多，请稍后再试。', 429);
  state.daily++; state.active++; client.daily++; client.count++; state.clients.set(ip, client);
  let released = false;
  return () => { if (!released) { state.active--; released = true; } };
}
