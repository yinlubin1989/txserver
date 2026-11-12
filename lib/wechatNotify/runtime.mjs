import { createNotifyService } from './service.mjs';
// One runtime instance keeps concurrency/rate accounting shared by both route handlers.
export const wechatNotify = createNotifyService();
