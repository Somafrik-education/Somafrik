import { createIdempotencyKey } from "../../lib/networkResilience";
import { hashOutboxPayload, parsePayloadJson, serializeOutboxPayload } from "./hash";
import { logRc3Outbox } from "./logs";
import { resolveOutboxOperation } from "./registry";
import {
  OUTBOX_ERROR,
  OUTBOX_LEASE_MS,
  OUTBOX_REPLAY_HORIZON_MS,
  type OutboxPartition,
  type OutboxRow,
  type OutboxStore,
  type OutboxTransport,
} from "./types";

const MAX_DRAIN_BATCH = 50;
const BACKOFF_CAP_MS = 15 * 60 * 1000;

function coded(code: string): Error & { code: string } {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}

function backoffMs(attemptCount: number): number {
  const exp = Math.max(0, attemptCount - 1);
  return Math.min(5000 * 2 ** exp, BACKOFF_CAP_MS);
}

function newOutboxId(createId: () => string): string {
  return `obx-${createId()}`;
}

function requirePartition(partition: OutboxPartition): void {
  if (!String(partition?.userId ?? "").trim() || !String(partition?.schoolId ?? "").trim()) {
    throw coded(OUTBOX_ERROR.PARTITION_MISMATCH);
  }
}

export async function enqueueOutboxOperation(input: {
  store: OutboxStore;
  partition: OutboxPartition;
  operationType: string;
  payload: unknown;
  now?: Date;
  createKey?: () => string;
}): Promise<{ outboxId: string; idempotencyKey: string; state: "pending" }> {
  if (!input.store.cipherVersion) {
    throw coded(OUTBOX_ERROR.SQLCIPHER_REQUIRED);
  }
  requirePartition(input.partition);
  const spec = resolveOutboxOperation(input.operationType);
  spec.validate(input.payload);
  const createKey = input.createKey ?? createIdempotencyKey;
  const idempotencyKey = createKey();
  const nowIso = (input.now ?? new Date()).toISOString();
  const payloadJson = serializeOutboxPayload(input.payload);
  const payloadHash = await hashOutboxPayload(input.payload);
  const row: OutboxRow = {
    outboxId: newOutboxId(createKey),
    idempotencyKey,
    userId: input.partition.userId,
    schoolId: input.partition.schoolId,
    operationType: input.operationType,
    payloadJson,
    payloadHash,
    state: "pending",
    attemptCount: 0,
    nextAttemptAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    ackedAt: null,
  };
  await input.store.withExclusiveTransaction(async (txn) => {
    await txn.insert(row);
  });
  logRc3Outbox({
    event: "enqueue",
    operationType: row.operationType,
    state: "pending",
    attemptCount: 0,
  });
  return { outboxId: row.outboxId, idempotencyKey, state: "pending" };
}

export async function reclaimExpiredLeases(store: OutboxStore, now = new Date()): Promise<number> {
  const count = await store.withExclusiveTransaction((txn) => txn.reclaimExpiredLeases(now.toISOString()));
  if (count > 0) {
    logRc3Outbox({
      event: "reclaim",
      operationType: "presence.upsert",
      state: "pending",
      retry: true,
    });
  }
  return count;
}

export async function claimNextOutboxOperation(input: {
  store: OutboxStore;
  partition: OutboxPartition;
  now?: Date;
  workerId?: string;
  leaseMs?: number;
}): Promise<OutboxRow | null> {
  const now = input.now ?? new Date();
  requirePartition(input.partition);
  const leaseMs = input.leaseMs ?? OUTBOX_LEASE_MS;
  const workerId = input.workerId ?? `worker-${createIdempotencyKey()}`;
  const claimed = await input.store.withExclusiveTransaction((txn) =>
    txn.claimNext({
      partition: input.partition,
      nowIso: now.toISOString(),
      leaseOwner: workerId,
      leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
    }),
  );
  if (claimed) {
    logRc3Outbox({
      event: "claim",
      operationType: claimed.operationType,
      state: "in_flight",
      attemptCount: claimed.attemptCount,
    });
  }
  return claimed;
}

export async function ackOutboxOperation(store: OutboxStore, outboxId: string, now = new Date()): Promise<void> {
  const nowIso = now.toISOString();
  await store.withExclusiveTransaction(async (txn) => {
    await txn.update(outboxId, {
      state: "acked",
      ackedAt: nowIso,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: nowIso,
      lastErrorCode: null,
    });
  });
}

export async function releaseForRetry(
  store: OutboxStore,
  row: OutboxRow,
  errorCode: string,
  now = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();
  await store.withExclusiveTransaction(async (txn) => {
    await txn.update(row.outboxId, {
      state: "pending",
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: errorCode,
      nextAttemptAt: new Date(now.getTime() + backoffMs(row.attemptCount)).toISOString(),
      updatedAt: nowIso,
    });
  });
}

export async function blockForAuthorization(
  store: OutboxStore,
  outboxId: string,
  errorCode: string,
  now = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();
  await store.withExclusiveTransaction(async (txn) => {
    await txn.update(outboxId, {
      state: "blocked_authorization",
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: errorCode,
      updatedAt: nowIso,
    });
  });
}

export async function markTerminalFailure(
  store: OutboxStore,
  outboxId: string,
  errorCode: string,
  now = new Date(),
): Promise<void> {
  const nowIso = now.toISOString();
  await store.withExclusiveTransaction(async (txn) => {
    await txn.update(outboxId, {
      state: "failed_terminal",
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: errorCode,
      updatedAt: nowIso,
    });
  });
}

function classificationOf(result: { status: number; code?: string }): string {
  const code = String(result.code ?? "");
  if (code === "NETWORK_UNAVAILABLE") return "NETWORK_UNAVAILABLE";
  if (code === "TIMEOUT") return "TIMEOUT";
  if (code === "BACKEND_UNREACHABLE") return "BACKEND_UNREACHABLE";
  if (result.status === 401 || code === "UNAUTHORIZED") return "UNAUTHORIZED";
  if (result.status === 403 || code === "FORBIDDEN") return "FORBIDDEN";
  if (result.status === 409 || code === "IDEMPOTENCY_KEY_REUSED") return "IDEMPOTENCY_KEY_REUSED";
  if (result.status >= 500) return "BACKEND_5XX";
  if (result.status === 400 || result.status === 422) return "BUSINESS_400";
  if (result.status >= 200 && result.status < 300) return "SUCCESS";
  return "BACKEND_UNREACHABLE";
}

function isIdempotentReplay(body: unknown): boolean {
  return Boolean(body && typeof body === "object" && !Array.isArray(body) && (body as { idempotentReplay?: unknown }).idempotentReplay === true);
}

export async function drainOutbox(input: {
  store: OutboxStore;
  partition: OutboxPartition;
  transport: OutboxTransport;
  now?: () => Date;
  workerId?: string;
  leaseMs?: number;
  afterSend?: (row: OutboxRow) => Promise<void>;
  horizonMs?: number;
}): Promise<{ processed: number; acked: number; ackedBodies: unknown[] }> {
  if (!input.store.cipherVersion) {
    throw coded(OUTBOX_ERROR.SQLCIPHER_REQUIRED);
  }
  requirePartition(input.partition);
  const clock = input.now ?? (() => new Date());
  const horizonMs = input.horizonMs ?? OUTBOX_REPLAY_HORIZON_MS;
  const workerId = input.workerId ?? `worker-${createIdempotencyKey()}`;
  let processed = 0;
  let acked = 0;
  const ackedBodies: unknown[] = [];

  await input.store.withExclusiveTransaction(async (txn) => {
    const now = clock();
    const reclaimed = await txn.reclaimExpiredLeases(now.toISOString());
    if (reclaimed > 0) {
      logRc3Outbox({
        event: "reclaim",
        operationType: "presence.upsert",
        state: "pending",
        retry: true,
      });
    }
    await txn.expireHorizon(
      input.partition,
      new Date(now.getTime() - horizonMs).toISOString(),
      now.toISOString(),
    );
  });

  for (let i = 0; i < MAX_DRAIN_BATCH; i += 1) {
    const now = clock();
    const claimed = await claimNextOutboxOperation({
      store: input.store,
      partition: input.partition,
      now,
      workerId,
      leaseMs: input.leaseMs,
    });
    if (!claimed) break;
    processed += 1;

    if (claimed.userId !== input.partition.userId || claimed.schoolId !== input.partition.schoolId) {
      await markTerminalFailure(input.store, claimed.outboxId, OUTBOX_ERROR.PARTITION_MISMATCH, clock());
      logRc3Outbox({
        operationType: claimed.operationType,
        state: "failed_terminal",
        attemptCount: claimed.attemptCount,
        classification: "PAYLOAD_TAMPERED",
        retry: false,
      });
      continue;
    }

    let payload: unknown;
    try {
      payload = parsePayloadJson(claimed.payloadJson);
      const currentHash = await hashOutboxPayload(payload);
      if (currentHash !== claimed.payloadHash) {
        throw coded(OUTBOX_ERROR.PAYLOAD_TAMPERED);
      }
    } catch {
      await markTerminalFailure(input.store, claimed.outboxId, OUTBOX_ERROR.PAYLOAD_TAMPERED, clock());
      logRc3Outbox({
        operationType: claimed.operationType,
        state: "failed_terminal",
        attemptCount: claimed.attemptCount,
        classification: "PAYLOAD_TAMPERED",
        retry: false,
      });
      continue;
    }

    const spec = resolveOutboxOperation(claimed.operationType);
    logRc3Outbox({
      event: "send",
      operationType: claimed.operationType,
      state: "in_flight",
      attemptCount: claimed.attemptCount,
    });
    const result = await input.transport.send({
      operationType: claimed.operationType,
      method: spec.method,
      path: spec.path,
      payload,
      idempotencyKey: claimed.idempotencyKey,
    });
    if (input.afterSend) {
      await input.afterSend(claimed);
    }

    const classification = isIdempotentReplay(result.body) ? "IDEMPOTENT_REPLAY" : classificationOf(result);
    if (classification === "SUCCESS" || classification === "IDEMPOTENT_REPLAY") {
      await ackOutboxOperation(input.store, claimed.outboxId, clock());
      acked += 1;
      ackedBodies.push(result.body);
      logRc3Outbox({
        event: "ack",
        operationType: claimed.operationType,
        state: "acked",
        attemptCount: claimed.attemptCount,
        classification,
        retry: false,
      });
      continue;
    }
    if (
      classification === "NETWORK_UNAVAILABLE" ||
      classification === "TIMEOUT" ||
      classification === "BACKEND_UNREACHABLE" ||
      classification === "BACKEND_5XX"
    ) {
      await releaseForRetry(input.store, claimed, classification, clock());
      logRc3Outbox({
        event: "retry",
        operationType: claimed.operationType,
        state: "pending",
        attemptCount: claimed.attemptCount,
        classification,
        retry: true,
      });
      continue;
    }
    if (classification === "UNAUTHORIZED" || classification === "FORBIDDEN") {
      await blockForAuthorization(input.store, claimed.outboxId, classification, clock());
      logRc3Outbox({
        operationType: claimed.operationType,
        state: "blocked_authorization",
        attemptCount: claimed.attemptCount,
        classification,
        retry: false,
      });
      continue;
    }
    await markTerminalFailure(input.store, claimed.outboxId, classification, clock());
    logRc3Outbox({
      operationType: claimed.operationType,
      state: "failed_terminal",
      attemptCount: claimed.attemptCount,
      classification,
      retry: false,
    });
  }

  return { processed, acked, ackedBodies };
}
