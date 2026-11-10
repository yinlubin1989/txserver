export class ArchiveError extends Error {
  constructor(public code: string, message: string, public httpStatus = 400, public acceptedIds: string[] = []) { super(message); }
}
export function invalid(message = '消息归档数据格式不正确。'): never {
  throw new ArchiveError('INVALID_RECORD', message);
}
export function unavailable(acceptedIds: string[] = []) {
  return new ArchiveError('ARCHIVE_UNAVAILABLE', '消息归档服务暂时不可用，请稍后重试。', 503, acceptedIds);
}
