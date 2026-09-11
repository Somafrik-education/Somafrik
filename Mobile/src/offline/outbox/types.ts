/**
 * Contrats Outbox RC3-1 — SQLCipher, replay exactly-once dans l'horizon supporté.
 * Les écrans n'importent pas ce module pour du SQL.
 */

export const OUTBOX_STATES = [
  "pending",
  "in_flight",
  "blocked_authorization",
  "failed_terminal",
  "acked",
] as const;

export type OutboxState = (typeof OUTBOX_STATES)[number];

export const OUTBOX_REPLAY_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;
export const SERVER_OFFLINE_IDEMPOTENCY_TTL_MS = 35 * 24 * 60 * 60 * 1000;
export const OUTBOX_LEASE_MS = 60 * 1000;

export const OUTBOX_ERROR = {
  UNKNOWN_OPERATION: "OUTBOX_UNKNOWN_OPERATION",
  SQLCIPHER_REQUIRED: "L1_SQLCIPHER_REQUIRED",
  PAYLOAD_INVALID: "OUTBOX_PAYLOAD_INVALID",
  PAYLOAD_TAMPERED: "OUTBOX_PAYLOAD_TAMPERED",
  HORIZON_EXPIRED: "OUTBOX_HORIZON_EXPIRED",
  PARTITION_MISMATCH: "OUTBOX_PARTITION_MISMATCH",
  IDEMPOTENCY_KEY_REUSED: "IDEMPOTENCY_KEY_REUSED",
} as const;

export type OutboxPartition = {
  userId: string;
  schoolId: string;
};

export type OutboxRow = {
  outboxId: string;
  idempotencyKey: string;
  userId: string;
  schoolId: string;
  operationType: string;
  payloadJson: string;
  payloadHash: string;
  state: OutboxState;
  attemptCount: number;
  nextAttemptAt: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
  ackedAt: string | null;
};

export type OutboxTxn = {
  insert(row: OutboxRow): Promise<void>;
  getById(outboxId: string): Promise<OutboxRow | null>;
  getByIdempotencyKey(idempotencyKey: string): Promise<OutboxRow | null>;
  claimNext(input: {
    partition: OutboxPartition;
    nowIso: string;
    leaseOwner: string;
    leaseExpiresAt: string;
  }): Promise<OutboxRow | null>;
  update(outboxId: string, patch: Partial<OutboxRow>): Promise<void>;
  reclaimExpiredLeases(nowIso: string): Promise<number>;
  expireHorizon(partition: OutboxPartition, cutoffIso: string, nowIso: string): Promise<number>;
};

export type OutboxStore = {
  kind: "sqlcipher" | "memory";
  cipherVersion: string;
  migrate(): Promise<void>;
  withExclusiveTransaction<T>(fn: (txn: OutboxTxn) => Promise<T>): Promise<T>;
  getById(outboxId: string): Promise<OutboxRow | null>;
  getByIdempotencyKey(idempotencyKey: string): Promise<OutboxRow | null>;
  listByPartition(partition: OutboxPartition): Promise<OutboxRow[]>;
  close(): Promise<void>;
};

export type OutboxTransportResult = {
  status: number;
  body?: unknown;
  code?: string;
};

export type OutboxTransport = {
  send(input: {
    operationType: string;
    method: "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    payload: unknown;
    idempotencyKey: string;
  }): Promise<OutboxTransportResult>;
};
