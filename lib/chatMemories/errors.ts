export class ChatMemoriesError extends Error {
  constructor(readonly code: string, message: string, readonly httpStatus: number) {
    super(message);
  }
}
