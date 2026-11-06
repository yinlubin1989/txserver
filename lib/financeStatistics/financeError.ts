export class FinanceError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 422) { super(message); this.code = code; this.httpStatus = httpStatus; }
}
