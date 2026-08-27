import type { OutboxPartition, OutboxRow, OutboxState, OutboxStore, OutboxTxn } from "./types";

export type OutboxRawSql = {
  run(sql: string, params?: unknown[]): Promise<void>;
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
};

type SqlOutboxRow = {
  outbox_id: string;
  idempotency_key: string;
  user_id: string;
  school_id: string;
  operation_type: string;
  payload_json: string;
  payload_hash: string;
  state: OutboxState;
  attempt_count: number;
  next_attempt_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
  acked_at: string | null;
};

function mapRow(row: SqlOutboxRow): OutboxRow {
  return {
    outboxId: row.outbox_id,
    idempotencyKey: row.idempotency_key,
    userId: row.user_id,
    schoolId: row.school_id,
    operationType: row.operation_type,
    payloadJson: row.payload_json,
    payloadHash: row.payload_hash,
    state: row.state,
    attemptCount: Number(row.attempt_count) || 0,
    nextAttemptAt: row.next_attempt_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ackedAt: row.acked_at,
  };
}

function createTxn(sql: OutboxRawSql): OutboxTxn {
  return {
    async insert(row) {
      await sql.run(
        `INSERT INTO l1_outbox (
           outbox_id, idempotency_key, user_id, school_id, operation_type,
           payload_json, payload_hash, state, attempt_count, next_attempt_at,
           lease_owner, lease_expires_at, last_error_code, created_at, updated_at, acked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.outboxId,
          row.idempotencyKey,
          row.userId,
          row.schoolId,
          row.operationType,
          row.payloadJson,
          row.payloadHash,
          row.state,
          row.attemptCount,
          row.nextAttemptAt,
          row.leaseOwner,
          row.leaseExpiresAt,
          row.lastErrorCode,
          row.createdAt,
          row.updatedAt,
          row.ackedAt,
        ],
      );
    },
    async getById(outboxId) {
      const row = await sql.get<SqlOutboxRow>(`SELECT * FROM l1_outbox WHERE outbox_id = ? LIMIT 1`, [outboxId]);
      return row ? mapRow(row) : null;
    },
    async getByIdempotencyKey(idempotencyKey) {
      const row = await sql.get<SqlOutboxRow>(
        `SELECT * FROM l1_outbox WHERE idempotency_key = ? LIMIT 1`,
        [idempotencyKey],
      );
      return row ? mapRow(row) : null;
    },
    async claimNext(input) {
      const current = await sql.get<SqlOutboxRow>(
        `SELECT * FROM l1_outbox
         WHERE user_id = ? AND school_id = ? AND state = 'pending'
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY created_at ASC, outbox_id ASC
         LIMIT 1`,
        [input.partition.userId, input.partition.schoolId, input.nowIso],
      );
      if (!current) return null;
      await sql.run(
        `UPDATE l1_outbox
         SET state = 'in_flight',
             lease_owner = ?,
             lease_expires_at = ?,
             attempt_count = attempt_count + 1,
             updated_at = ?
         WHERE outbox_id = ? AND state = 'pending'`,
        [input.leaseOwner, input.leaseExpiresAt, input.nowIso, current.outbox_id],
      );
      const claimed = await sql.get<SqlOutboxRow>(
        `SELECT * FROM l1_outbox WHERE outbox_id = ? LIMIT 1`,
        [current.outbox_id],
      );
      if (!claimed || claimed.state !== "in_flight" || claimed.lease_owner !== input.leaseOwner) {
        return null;
      }
      return mapRow(claimed);
    },
    async update(outboxId, patch) {
      const current = await sql.get<SqlOutboxRow>(`SELECT * FROM l1_outbox WHERE outbox_id = ? LIMIT 1`, [outboxId]);
      if (!current) return;
      const next = mapRow(current);
      await sql.run(
        `UPDATE l1_outbox SET
           state = ?,
           attempt_count = ?,
           next_attempt_at = ?,
           lease_owner = ?,
           lease_expires_at = ?,
           last_error_code = ?,
           updated_at = ?,
           acked_at = ?
         WHERE outbox_id = ?`,
        [
          patch.state ?? next.state,
          patch.attemptCount ?? next.attemptCount,
          "nextAttemptAt" in patch ? patch.nextAttemptAt ?? null : next.nextAttemptAt,
          "leaseOwner" in patch ? patch.leaseOwner ?? null : next.leaseOwner,
          "leaseExpiresAt" in patch ? patch.leaseExpiresAt ?? null : next.leaseExpiresAt,
          "lastErrorCode" in patch ? patch.lastErrorCode ?? null : next.lastErrorCode,
          patch.updatedAt ?? next.updatedAt,
          "ackedAt" in patch ? patch.ackedAt ?? null : next.ackedAt,
          outboxId,
        ],
      );
    },
    async reclaimExpiredLeases(nowIso) {
      const stale = await sql.all<{ outbox_id: string }>(
        `SELECT outbox_id FROM l1_outbox
         WHERE state = 'in_flight' AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
        [nowIso],
      );
      if (!stale.length) return 0;
      await sql.run(
        `UPDATE l1_outbox
         SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE state = 'in_flight' AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
        [nowIso, nowIso],
      );
      return stale.length;
    },
    async expireHorizon(partition, cutoffIso, nowIso) {
      const stale = await sql.all<{ outbox_id: string }>(
        `SELECT outbox_id FROM l1_outbox
         WHERE user_id = ? AND school_id = ?
           AND state NOT IN ('acked', 'failed_terminal')
           AND created_at < ?`,
        [partition.userId, partition.schoolId, cutoffIso],
      );
      if (!stale.length) return 0;
      await sql.run(
        `UPDATE l1_outbox
         SET state = 'failed_terminal',
             last_error_code = 'OUTBOX_HORIZON_EXPIRED',
             lease_owner = NULL,
             lease_expires_at = NULL,
             updated_at = ?
         WHERE user_id = ? AND school_id = ?
           AND state NOT IN ('acked', 'failed_terminal')
           AND created_at < ?`,
        [nowIso, partition.userId, partition.schoolId, cutoffIso],
      );
      return stale.length;
    },
  };
}

export function createSqliteOutboxStore(deps: {
  cipherVersion: string;
  main: OutboxRawSql;
  withExclusive: <T>(fn: (sql: OutboxRawSql) => Promise<T>) => Promise<T>;
}): OutboxStore {
  const txnApi = createTxn(deps.main);
  return {
    kind: "sqlcipher",
    cipherVersion: deps.cipherVersion,
    async migrate() {
      return;
    },
    async withExclusiveTransaction<T>(fn: (txn: OutboxTxn) => Promise<T>): Promise<T> {
      return deps.withExclusive(async (sql) => fn(createTxn(sql)));
    },
    getById: (outboxId) => txnApi.getById(outboxId),
    getByIdempotencyKey: (idempotencyKey) => txnApi.getByIdempotencyKey(idempotencyKey),
    async listByPartition(partition: OutboxPartition) {
      const rows = await deps.main.all<SqlOutboxRow>(
        `SELECT * FROM l1_outbox WHERE user_id = ? AND school_id = ?
         ORDER BY created_at ASC, outbox_id ASC`,
        [partition.userId, partition.schoolId],
      );
      return rows.map(mapRow);
    },
    async close() {
      return;
    },
  };
}
