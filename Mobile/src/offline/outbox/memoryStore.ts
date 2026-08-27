import type { OutboxPartition, OutboxRow, OutboxStore, OutboxTxn } from "./types";
import { L1_ERROR } from "../l1/types";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function enqueueWrite<T>(tail: { current: Promise<void> }, fn: () => Promise<T>): Promise<T> {
  const run = tail.current.then(fn, fn);
  tail.current = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export type MemoryOutboxBucket = {
  rows: Map<string, OutboxRow>;
};

export function createMemoryOutboxBucket(): MemoryOutboxBucket {
  return { rows: new Map() };
}

function sortRows(rows: OutboxRow[]): OutboxRow[] {
  return [...rows].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.outboxId < b.outboxId ? -1 : 1;
  });
}

function createTxn(rows: Map<string, OutboxRow>): OutboxTxn {
  return {
    async insert(row) {
      if (rows.has(row.outboxId)) {
        throw new Error("OUTBOX_ID_CONFLICT");
      }
      for (const existing of rows.values()) {
        if (existing.idempotencyKey === row.idempotencyKey) {
          throw new Error("IDEMPOTENCY_KEY_UNIQUE");
        }
      }
      rows.set(row.outboxId, clone(row));
    },
    async getById(outboxId) {
      const row = rows.get(outboxId);
      return row ? clone(row) : null;
    },
    async getByIdempotencyKey(idempotencyKey) {
      for (const row of rows.values()) {
        if (row.idempotencyKey === idempotencyKey) return clone(row);
      }
      return null;
    },
    async claimNext(input) {
      const eligible = sortRows([...rows.values()]).filter((row) => {
        if (row.userId !== input.partition.userId || row.schoolId !== input.partition.schoolId) return false;
        if (row.state !== "pending") return false;
        if (row.nextAttemptAt && row.nextAttemptAt > input.nowIso) return false;
        return true;
      });
      const next = eligible[0];
      if (!next) return null;
      const claimed: OutboxRow = {
        ...next,
        state: "in_flight",
        leaseOwner: input.leaseOwner,
        leaseExpiresAt: input.leaseExpiresAt,
        attemptCount: next.attemptCount + 1,
        updatedAt: input.nowIso,
      };
      rows.set(claimed.outboxId, claimed);
      return clone(claimed);
    },
    async update(outboxId, patch) {
      const current = rows.get(outboxId);
      if (!current) return;
      const next: OutboxRow = {
        ...current,
        state: patch.state ?? current.state,
        attemptCount: patch.attemptCount ?? current.attemptCount,
        nextAttemptAt: "nextAttemptAt" in patch ? patch.nextAttemptAt ?? null : current.nextAttemptAt,
        leaseOwner: "leaseOwner" in patch ? patch.leaseOwner ?? null : current.leaseOwner,
        leaseExpiresAt: "leaseExpiresAt" in patch ? patch.leaseExpiresAt ?? null : current.leaseExpiresAt,
        lastErrorCode: "lastErrorCode" in patch ? patch.lastErrorCode ?? null : current.lastErrorCode,
        updatedAt: patch.updatedAt ?? current.updatedAt,
        ackedAt: "ackedAt" in patch ? patch.ackedAt ?? null : current.ackedAt,
      };
      rows.set(outboxId, next);
    },
    async reclaimExpiredLeases(nowIso) {
      let count = 0;
      for (const row of rows.values()) {
        if (row.state !== "in_flight") continue;
        if (row.leaseExpiresAt && row.leaseExpiresAt > nowIso) continue;
        rows.set(row.outboxId, {
          ...row,
          state: "pending",
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: nowIso,
        });
        count += 1;
      }
      return count;
    },
    async expireHorizon(partition, cutoffIso, nowIso) {
      let count = 0;
      for (const row of rows.values()) {
        if (row.userId !== partition.userId || row.schoolId !== partition.schoolId) continue;
        if (row.state === "acked" || row.state === "failed_terminal") continue;
        if (row.createdAt >= cutoffIso) continue;
        rows.set(row.outboxId, {
          ...row,
          state: "failed_terminal",
          lastErrorCode: "OUTBOX_HORIZON_EXPIRED",
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: nowIso,
        });
        count += 1;
      }
      return count;
    },
  };
}

export function createMemoryOutboxStore(options?: {
  cipherVersion?: string;
  cipherKey?: string;
  openKey?: string;
  bucket?: MemoryOutboxBucket;
}): OutboxStore {
  const expectedKey = options?.cipherKey ?? "memory-test-key";
  const openKey = options?.openKey ?? expectedKey;
  if (openKey !== expectedKey) {
    const error = new Error(L1_ERROR.UNLOCK_FAILED) as Error & { code: string };
    error.code = L1_ERROR.UNLOCK_FAILED;
    throw error;
  }
  const cipherVersion = options?.cipherVersion ?? "4.7.0 community";
  if (!cipherVersion) {
    const error = new Error(L1_ERROR.SQLCIPHER_REQUIRED) as Error & { code: string };
    error.code = L1_ERROR.SQLCIPHER_REQUIRED;
    throw error;
  }

  const bucket = options?.bucket ?? createMemoryOutboxBucket();
  const writeTail = { current: Promise.resolve() };
  const live = bucket.rows;

  return {
    kind: "memory",
    cipherVersion,
    async migrate() {
      return;
    },
    async withExclusiveTransaction<T>(fn: (txn: OutboxTxn) => Promise<T>): Promise<T> {
      return enqueueWrite(writeTail, async () => {
        const snapshot = new Map([...live.entries()].map(([key, row]) => [key, clone(row)]));
        try {
          const result = await fn(createTxn(live));
          return result;
        } catch (error) {
          live.clear();
          for (const [key, row] of snapshot) live.set(key, row);
          throw error;
        }
      });
    },
    async getById(outboxId) {
      const row = live.get(outboxId);
      return row ? clone(row) : null;
    },
    async getByIdempotencyKey(idempotencyKey) {
      for (const row of live.values()) {
        if (row.idempotencyKey === idempotencyKey) return clone(row);
      }
      return null;
    },
    async listByPartition(partition: OutboxPartition) {
      return sortRows(
        [...live.values()].filter((row) => row.userId === partition.userId && row.schoolId === partition.schoolId),
      );
    },
    async close() {
      return;
    },
  };
}
