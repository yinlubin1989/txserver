export class LedgerError extends Error {
  constructor(public code: string, message: string, public httpStatus = 400) { super(message); }
}

export function invalid(message = '账单数据不完整，请重新统计后保存。'): never {
  throw new LedgerError('INVALID_BILL', message, 400);
}
