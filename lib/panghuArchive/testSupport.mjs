import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const requireModule = createRequire(import.meta.url);
const directory = path.dirname(fileURLToPath(import.meta.url));
export function loadModule(file, overrides = {}) {
  const cache = new Map();
  function load(filename) {
    const absolute = path.resolve(directory, filename);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const loaded = { exports: {} }; cache.set(absolute, loaded);
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    const resolve = name => Object.hasOwn(overrides, name) ? overrides[name] : name.startsWith('.') ? load(path.resolve(path.dirname(absolute), `${name}.ts`)) : requireModule(name);
    new Function('require', 'module', 'exports', code)(resolve, loaded, loaded.exports);
    return loaded.exports;
  }
  return load(file);
}
export const hash = value => createHash('sha256').update(value).digest('hex');
export const storageId = row => hash(JSON.stringify([row.ownerHash, row.record.id]));
export function record(number = 1, changes = {}) {
  return { id: number.toString(16).padStart(64, '0'), profile: 'fake-corp:fake-user', direction: 'incoming', source: 'incoming', peerId: 'fake-peer', peerName: '虚构联系人', conversationId: 'fake-conversation', text: '仅用于自动测试的虚构消息', occurredAt: '2026-11-10T00:00:00.000Z', status: 'received', sourceId: `fake-event-${number}`, ...changes };
}
export class MemoryStorage {
  sessions = new Map(); adminSessions = new Map(); records = new Map(); insertCount = 0; failAt = 0;
  async createSession(hash, date) { this.sessions.set(hash, date); }
  async hasSession(hash) { return this.sessions.has(hash); }
  async insertRecord(value) {
    this.insertCount++;
    if (this.failAt === this.insertCount) throw new Error('fake storage failure');
    const key = storageId(value);
    const existing = this.records.get(key);
    if (existing) return structuredClone(existing);
    this.records.set(key, structuredClone(value)); return structuredClone(value);
  }
  async listRecords(ownerHash, cursor, limit) {
    return [...this.records.values()].filter(row => row.ownerHash === ownerHash && (!cursor || row.archivedAt < cursor.archivedAt || row.archivedAt === cursor.archivedAt && row.record.id < cursor.id)).sort((a, b) => b.archivedAt.localeCompare(a.archivedAt) || b.record.id.localeCompare(a.record.id)).slice(0, limit).map(row => structuredClone(row));
  }
  async createAdminSession(hash, expiresAt) { this.adminSessions.set(hash, expiresAt); }
  async hasAdminSession(hash, now) { return this.adminSessions.has(hash) && this.adminSessions.get(hash) > now; }
  async deleteAdminSession(hash) { this.adminSessions.delete(hash); }
  async listAdminRecords(filters, cursor, limit) {
    return [...this.records.values()].filter(row => (!filters.profile || row.record.profile === filters.profile) && (!filters.peerId || row.record.peerId === filters.peerId) && (!filters.from || row.record.occurredAt >= filters.from) && (!filters.to || row.record.occurredAt <= filters.to) && (!cursor || row.archivedAt < cursor.archivedAt || row.archivedAt === cursor.archivedAt && storageId(row) < cursor.key)).sort((a, b) => b.archivedAt.localeCompare(a.archivedAt) || storageId(b).localeCompare(storageId(a))).slice(0, limit).map(row => structuredClone(row));
  }
}
export function setup() {
  const storage = new MemoryStorage();
  const { ArchiveService } = loadModule('./service.ts');
  const service = new ArchiveService(storage, () => new Date('2026-11-10T01:00:00.000Z'));
  return { storage, service };
}
