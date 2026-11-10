export interface ArchiveRecord {
  id: string;
  ownerId: string;
  profile: string;
  peerId: string;
  peerName: string;
  conversationId: string | null;
  direction: "incoming" | "outgoing";
  source: "incoming" | "auto_reply" | "manual_reply" | "outbound";
  status: "received" | "sent" | "unknown";
  text: string;
  sourceId: string;
  occurredAt: string;
  archivedAt: string;
}

export interface ArchiveFilters {
  profile: string;
  peerId: string;
  from: string;
  to: string;
}

export const EMPTY_FILTERS: ArchiveFilters = {
  profile: "",
  peerId: "",
  from: "",
  to: "",
};

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const API = "/api/panghu-archive/admin";
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function request(
  path: string,
  options: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${API}${path}`, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      isObject(data) && data.ok === false && typeof data.error === "string"
        ? data.error
        : "请求失败，请稍后重试。";
    throw new AdminApiError(message, response.status);
  }
  if (!isObject(data) || data.ok !== true)
    throw new Error("服务响应格式异常，请稍后重试。");
  return data;
}

export async function readSession(signal: AbortSignal): Promise<void> {
  const data = await request("/session", { signal });
  if (data.authenticated !== true) throw new Error("登录状态响应异常。");
}

export async function createSession(
  password: string,
  signal: AbortSignal,
): Promise<void> {
  const data = await request("/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    signal,
  });
  if (data.authenticated !== true) throw new Error("登录状态响应异常。");
}

export async function deleteSession(signal: AbortSignal): Promise<void> {
  const data = await request("/session", { method: "DELETE", signal });
  if (data.authenticated !== false)
    throw new Error("退出状态响应异常，请重试。");
}

function isRecord(value: unknown): value is ArchiveRecord {
  if (!isObject(value)) return false;
  const strings = [
    "id",
    "ownerId",
    "profile",
    "peerId",
    "sourceId",
    "occurredAt",
    "archivedAt",
  ];
  return (
    strings.every(
      (key) => typeof value[key] === "string" && value[key] !== "",
    ) &&
    typeof value.peerName === "string" &&
    typeof value.text === "string" &&
    (value.conversationId === null ||
      typeof value.conversationId === "string") &&
    (value.direction === "incoming" || value.direction === "outgoing") &&
    (value.source === "incoming" ||
      value.source === "auto_reply" ||
      value.source === "manual_reply" ||
      value.source === "outbound") &&
    (value.status === "received" ||
      value.status === "sent" ||
      value.status === "unknown") &&
    Number.isFinite(Date.parse(value.occurredAt as string)) &&
    Number.isFinite(Date.parse(value.archivedAt as string))
  );
}

export async function readRecords(
  filters: ArchiveFilters,
  cursor: string | null,
  signal: AbortSignal,
): Promise<{ records: ArchiveRecord[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (filters.profile.trim()) params.set("profile", filters.profile.trim());
  if (filters.peerId.trim()) params.set("peerId", filters.peerId.trim());
  for (const key of ["from", "to"] as const) {
    if (!filters[key]) continue;
    const date = new Date(filters[key]);
    if (!Number.isFinite(date.getTime()))
      throw new Error("请选择有效的起止时间。");
    params.set(key, date.toISOString());
  }
  if (
    filters.from &&
    filters.to &&
    new Date(filters.from) > new Date(filters.to)
  )
    throw new Error("开始时间不能晚于结束时间。");
  if (cursor !== null) params.set("cursor", cursor);
  const data = await request(`/records${params.size ? `?${params}` : ""}`, {
    signal,
  });
  if (
    !Array.isArray(data.records) ||
    !data.records.every(isRecord) ||
    !(
      data.nextCursor === null ||
      (typeof data.nextCursor === "string" && data.nextCursor.length > 0)
    )
  ) {
    throw new Error("归档记录响应格式异常，请重试。");
  }
  return { records: data.records, nextCursor: data.nextCursor };
}
