export type CloudMessage = {
  id: string;
  profile: string;
  direction: 'incoming' | 'outgoing';
  source: 'incoming' | 'auto_reply' | 'manual_reply' | 'outbound';
  peerId: string;
  peerName: string;
  conversationId: string | null;
  text: string;
  occurredAt: string;
  status: 'received' | 'sent' | 'unknown';
  sourceId: string;
};
export type ArchivedMessage = CloudMessage & { archivedAt: string };
export type ArchiveCursor = { archivedAt: string; id: string };
export type AdminCursor = { archivedAt: string; key: string; filterHash: string };
export type AdminFilters = { profile: string | null; peerId: string | null; from: string | null; to: string | null };
export type StoredMessage = { record: CloudMessage; ownerHash: string; contentHash: string; archivedAt: string };
export type EncryptedPayload = { version: 1; iv: string; tag: string; data: string };
export interface ArchiveStorage {
  createSession(tokenHash: string, createdAt: string): Promise<void>;
  hasSession(tokenHash: string): Promise<boolean>;
  insertRecord(value: StoredMessage): Promise<StoredMessage>;
  listRecords(ownerHash: string, cursor: ArchiveCursor | null, limit: number): Promise<StoredMessage[]>;
  createAdminSession(tokenHash: string, expiresAt: string): Promise<void>;
  hasAdminSession(tokenHash: string, now: string): Promise<boolean>;
  deleteAdminSession(tokenHash: string): Promise<void>;
  listAdminRecords(filters: AdminFilters, cursor: AdminCursor | null, limit: number): Promise<StoredMessage[]>;
}
