import type { BillSummary } from "./present";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-f0-9]{24}$/;
const STORAGE_KEY = "txserver-finance-ledger-session-v1";

export class LedgerError extends Error {
  code: string;
  constructor(message: string, code = "REQUEST_FAILED") {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

export type OwnerBill = {
  id: string;
  createdAt: string;
  report: unknown;
  text: string;
  visibility: "private" | "public";
};

export type SharedBill = { id: string; createdAt: string; report: unknown };

type ListResult = { bills: BillSummary[]; nextCursor: string | null };

let activeToken: string | null = null;
let sessionPromise: Promise<string> | null = null;

function failedMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { message: fallback, code: "REQUEST_FAILED" };
  const body = payload as { status?: unknown; error?: unknown; code?: unknown };
  return {
    message: body.status === "failed" && typeof body.error === "string" ? body.error : fallback,
    code: body.status === "failed" && typeof body.code === "string" ? body.code : "REQUEST_FAILED",
  };
}

async function request(path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`/api/finance-ledger${path}`, { ...init, headers, cache: "no-store" });
  } catch {
    throw new LedgerError("网络连接失败，请重试。当前账单已保留。", "NETWORK");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const failed = failedMessage(payload, "账本服务暂时不可用，请稍后重试。");
    throw new LedgerError(failed.message, failed.code);
  }
  if (!payload || typeof payload !== "object" || (payload as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      (payload as { status?: unknown }).status !== "completed") {
    throw new LedgerError("账本返回的数据格式异常，请稍后重试。", "INVALID");
  }
  return payload as Record<string, unknown>;
}

function readStored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === null) return null;
    if (!TOKEN_PATTERN.test(value)) throw new LedgerError("账本访问凭证异常，暂时无法打开。", "INVALID");
    return value;
  } catch (error) {
    if (error instanceof LedgerError) throw error;
    throw new LedgerError("无法读取本机账本，请稍后重试。", "STORAGE");
  }
}

async function ensureSession(force = false) {
  if (!force && activeToken && TOKEN_PATTERN.test(activeToken)) return activeToken;
  if (!force) {
    const stored = readStored();
    if (stored) {
      activeToken = stored;
      return stored;
    }
  }
  if (!sessionPromise) {
    sessionPromise = request("/session", { method: "POST" }).then((payload) => {
      const session = payload.session;
      const token = session && typeof session === "object" && !Array.isArray(session) ? (session as { token?: unknown }).token : null;
      if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) throw new LedgerError("账本返回的数据格式异常，请稍后重试。", "INVALID");
      localStorage.setItem(STORAGE_KEY, token);
      activeToken = token;
      return token;
    }).finally(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

async function ownerRequest(path: string, init: RequestInit = {}) {
  const token = await ensureSession();
  try {
    return await request(path, init, token);
  } catch (error) {
    if (!(error instanceof LedgerError) || error.code !== "UNAUTHORIZED") throw error;
    activeToken = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* 新凭证仍可建立。 */ }
    return request(path, init, await ensureSession(true));
  }
}

function checkId(id: string) {
  if (!ID_PATTERN.test(id)) throw new LedgerError("账单地址无效。", "INVALID");
}

function parseList(payload: Record<string, unknown>): ListResult {
  const cursor = payload.nextCursor;
  if (!Array.isArray(payload.bills) || (cursor !== null && (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(cursor)))) {
    throw new LedgerError("账本返回的数据格式异常，请稍后重试。", "INVALID");
  }
  const bills = payload.bills.map((bill) => {
    if (!bill || typeof bill !== "object" || Array.isArray(bill)) throw new LedgerError("账本返回的数据格式异常，请稍后重试。", "INVALID");
    const item = bill as BillSummary;
    if (!ID_PATTERN.test(item.id) || typeof item.createdAt !== "string" || (item.visibility !== "private" && item.visibility !== "public") ||
        !item.period || !Number.isInteger(item.period.month) || !item.totals || !Number.isSafeInteger(item.reviewCount) || item.reviewCount < 0) {
      throw new LedgerError("账本返回的数据格式异常，请稍后重试。", "INVALID");
    }
    return item;
  });
  return { bills, nextCursor: cursor };
}

function parseOwnerBill(payload: Record<string, unknown>): OwnerBill {
  const bill = payload.bill;
  if (!bill || typeof bill !== "object" || Array.isArray(bill)) throw new LedgerError("账本返回的数据格式异常，请稍后重试。", "INVALID");
  const item = bill as OwnerBill;
  if (!ID_PATTERN.test(item.id) || typeof item.text !== "string" || (item.visibility !== "private" && item.visibility !== "public") || !item.report) {
    throw new LedgerError("账本返回的数据格式异常，请稍后重试。", "INVALID");
  }
  return item;
}

function parseSharedBill(payload: Record<string, unknown>): SharedBill {
  const bill = payload.bill;
  if (!bill || typeof bill !== "object" || Array.isArray(bill)) throw new LedgerError("账本返回的数据格式异常，请稍后重试。", "INVALID");
  const item = bill as SharedBill & { text?: unknown };
  if (!ID_PATTERN.test(item.id) || !item.report || Object.prototype.hasOwnProperty.call(item, "text")) {
    throw new LedgerError("账本返回的数据格式异常，请稍后重试。", "INVALID");
  }
  return item;
}

export async function calculateStatistics(text: string, signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch("/api/finance-statistics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new LedgerError("请求未完成，请检查网络后重试。原文已保留。", "NETWORK");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const failed = failedMessage(payload, "统计服务暂时不可用，请稍后重试。");
    throw new LedgerError(failed.message, failed.code);
  }
  return payload;
}

export function listBills(cursor: string | null) {
  return ownerRequest(`/bills${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`).then(parseList);
}

export function listPublicBills(cursor: string | null) {
  return request(`/public${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`).then((payload) => {
    const result = parseList(payload);
    if (result.bills.some((bill) => bill.visibility !== "public")) throw new LedgerError("账本返回的数据格式异常，请稍后重试。", "INVALID");
    return result;
  });
}

export function getBill(id: string) {
  checkId(id);
  return ownerRequest(`/bills/${id}`).then(parseOwnerBill);
}

export function getPublicBill(id: string) {
  checkId(id);
  return request(`/public/${id}`).then(parseSharedBill);
}

export function getSharedBill(token: string) {
  if (!TOKEN_PATTERN.test(token)) throw new LedgerError("分享地址无效，请向分享者获取新的账单。", "INVALID");
  return request(`/shared/${token}`).then(parseSharedBill);
}

export function saveBill(body: { report: unknown; text: string; clientRequestId: string }) {
  return ownerRequest("/bills", { method: "POST", body: JSON.stringify(body) }).then(parseOwnerBill);
}

export async function createShare(id: string) {
  checkId(id);
  const payload = await ownerRequest(`/bills/${id}/share`, { method: "POST" });
  const share = payload.share;
  const token = share && typeof share === "object" && !Array.isArray(share) ? (share as { token?: unknown }).token : null;
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) throw new LedgerError("账本返回的数据格式异常，请稍后重试。", "INVALID");
  return token;
}

export async function setVisibility(id: string, visibility: "private" | "public") {
  checkId(id);
  const payload = await ownerRequest(`/bills/${id}`, { method: "PATCH", body: JSON.stringify({ visibility }) });
  const bill = payload.bill;
  if (!bill || typeof bill !== "object" || (bill as { visibility?: unknown }).visibility !== visibility) {
    throw new LedgerError("账本返回的数据格式异常，请稍后重试。", "INVALID");
  }
}

export async function deleteBill(id: string) {
  checkId(id);
  const payload = await ownerRequest(`/bills/${id}`, { method: "DELETE" });
  const bill = payload.bill;
  if (!bill || typeof bill !== "object" || (bill as { deleted?: unknown }).deleted !== true) {
    throw new LedgerError("账本返回的数据格式异常，请稍后重试。", "INVALID");
  }
}
