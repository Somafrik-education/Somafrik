/**
 * Contrats L1 Mobile — miroir du protocole serveur, pas des anciens modèles UI.
 * Le cache SQLite est un snapshot jetable de PostgreSQL, jamais une source canonique.
 */

export const L1_RESOURCES = [
  "classes",
  "students",
  "assignments",
  "school-courses",
  "course-schedules",
] as const;

export type L1Resource = (typeof L1_RESOURCES)[number];

export const L1_SYNC_STATES = ["empty", "reconciling", "ready", "blocked_authorization"] as const;
export type L1SyncState = (typeof L1_SYNC_STATES)[number];

export const L1_LOCAL_SCHEMA_VERSION = 2 as const;

export const L1_DB_KEY_SECURESTORE = "somafrik.l1DbKeyV1";
export const L1_DB_FILENAME = "somafrik-l1-v1.db";

export const L1_ERROR = {
  SQLCIPHER_REQUIRED: "L1_SQLCIPHER_REQUIRED",
  SCHOOL_ID_REQUIRED: "L1_SCHOOL_ID_REQUIRED",
  USER_ID_REQUIRED: "L1_USER_ID_REQUIRED",
  UNLOCK_FAILED: "L1_SQLCIPHER_UNLOCK_FAILED",
  PAYLOAD_INVALID: "L1_PAYLOAD_INVALID",
  CURSOR_INVALID_LOOP: "L1_CURSOR_INVALID_LOOP",
} as const;

export type L1Partition = {
  userId: string;
  schoolId: string;
  schoolCode: string;
};

export type L1SyncMeta = {
  userId: string;
  schoolId: string;
  schoolCode: string;
  resource: L1Resource;
  cursor: string | null;
  scopeHash: string | null;
  state: L1SyncState;
  schemaVersion: number;
  lastSuccessAt: string | null;
};

export type L1Page = {
  resource: L1Resource;
  mode: "full" | "delta" | "full_required" | "unavailable";
  cursorStatus: "ok" | "expired" | "scope_changed" | "invalid" | string;
  scopeHash: string;
  items: L1Item[];
  nextCursor: string;
  hasMore: boolean;
};

export type L1Item = Record<string, unknown> & {
  id: string;
  tombstone?: boolean;
};

export type SqlValue = string | number | null;

/** Écritures d'une transaction exclusive — toujours le handle `txn`, jamais le DB global. */
export type L1Txn = {
  upsertRow(resource: L1Resource, partition: L1Partition, row: Record<string, SqlValue>): Promise<void>;
  deleteRow(resource: L1Resource, partition: L1Partition, id: string): Promise<void>;
  purgeResource(partition: L1Partition, resource: L1Resource): Promise<void>;
  purgePartition(partition: L1Partition): Promise<void>;
  getRow(
    resource: L1Resource,
    partition: L1Partition,
    id: string,
  ): Promise<Record<string, SqlValue> | null>;
  listRows(resource: L1Resource, partition: L1Partition): Promise<Record<string, SqlValue>[]>;
  getMeta(partition: L1Partition, resource: L1Resource): Promise<L1SyncMeta | null>;
  putMeta(meta: L1SyncMeta): Promise<void>;
};

export type L1Store = L1Txn & {
  kind: "sqlcipher" | "memory";
  cipherVersion: string;
  migrate(): Promise<void>;
  withExclusiveTransaction<T>(fn: (txn: L1Txn) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export type L1Api = {
  fetchPage(resource: L1Resource, cursor: string | null): Promise<L1Page>;
};

export type L1OpenFailure = {
  ok: false;
  code: typeof L1_ERROR.SQLCIPHER_REQUIRED | typeof L1_ERROR.UNLOCK_FAILED;
  message: string;
};

export type L1OpenSuccess = {
  ok: true;
  store: L1Store;
};

export type L1OpenResult = L1OpenSuccess | L1OpenFailure;
