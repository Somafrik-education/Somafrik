/**
 * Façade Appel / Présences — enqueue SQLCipher COMMIT puis drain.
 * Les écrans n'ouvrent pas SQLite.
 */
import { openNativeL1Database, outboxStoreFor } from "../l1/database";
import { resolveL1Partition } from "../l1/lifecycle";
import { drainOutbox, enqueueOutboxOperation } from "./engine";
import { logRc3Outbox, logRc3PhysicalPresenceSmoke } from "./logs";
import { parsePayloadJson } from "./hash";
import type { OutboxPartition, OutboxRow, OutboxState, OutboxStore, OutboxTransport } from "./types";

export type PresenceOutboxView = {
  outboxId: string;
  idempotencyKey: string;
  state: OutboxState;
  payload: unknown;
};

export type PresenceWriteOutcome =
  | "acked"
  | "queued"
  | "blocked_authorization"
  | "failed_terminal"
  | "in_flight"
  | "unavailable";

export type PresenceWriteResult = {
  outcome: PresenceWriteOutcome;
  outboxId?: string;
  idempotencyKey?: string;
  ackedBodies: unknown[];
};

type PresenceListener = (views: PresenceOutboxView[]) => void;

const listeners = new Set<PresenceListener>();

function defaultTransport(): OutboxTransport {
  const { createHttpOutboxTransport } = require("./httpTransport") as typeof import("./httpTransport");
  return createHttpOutboxTransport();
}

export function subscribePresenceOutbox(listener: PresenceListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(views: PresenceOutboxView[]): void {
  for (const listener of listeners) listener(views);
}

function asView(row: OutboxRow): PresenceOutboxView {
  let payload: unknown = null;
  try {
    payload = parsePayloadJson(row.payloadJson);
  } catch {
    payload = null;
  }
  return {
    outboxId: row.outboxId,
    idempotencyKey: row.idempotencyKey,
    state: row.state,
    payload,
  };
}

function presenceClassDate(payload: unknown): { classId: string; date: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { classId: "", date: "" };
  }
  const body = payload as Record<string, unknown>;
  return {
    classId: String(body.classId ?? "").trim(),
    date: String(body.date ?? "").trim(),
  };
}

async function findActivePresenceRow(
  store: OutboxStore,
  partition: OutboxPartition,
  payload: unknown,
): Promise<OutboxRow | null> {
  const wanted = presenceClassDate(payload);
  if (!wanted.classId || !wanted.date) return null;
  const rows = await store.listByPartition(partition);
  for (const row of rows) {
    if (row.operationType !== "presence.upsert") continue;
    if (row.state === "acked") continue;
    const current = presenceClassDate(asView(row).payload);
    if (current.classId === wanted.classId && current.date === wanted.date) return row;
  }
  return null;
}

export async function listPresenceOutboxViews(
  store: OutboxStore,
  partition: OutboxPartition,
): Promise<PresenceOutboxView[]> {
  const rows = await store.listByPartition(partition);
  return rows.filter((row) => row.operationType === "presence.upsert").map(asView);
}

export async function enqueueAndDrainPresenceUpsert(input: {
  store: OutboxStore;
  partition: OutboxPartition;
  payload: unknown;
  transport?: OutboxTransport;
}): Promise<PresenceWriteResult> {
  const existing = await findActivePresenceRow(input.store, input.partition, input.payload);
  if (existing) {
    const views = await listPresenceOutboxViews(input.store, input.partition);
    notify(views);
    if (existing.state === "in_flight") {
      return {
        outcome: "in_flight",
        outboxId: existing.outboxId,
        idempotencyKey: existing.idempotencyKey,
        ackedBodies: [],
      };
    }
    if (existing.state === "blocked_authorization") {
      return {
        outcome: "blocked_authorization",
        outboxId: existing.outboxId,
        idempotencyKey: existing.idempotencyKey,
        ackedBodies: [],
      };
    }
    if (existing.state === "failed_terminal") {
      return {
        outcome: "failed_terminal",
        outboxId: existing.outboxId,
        idempotencyKey: existing.idempotencyKey,
        ackedBodies: [],
      };
    }
    logRc3Outbox({
      event: "enqueue",
      operationType: "presence.upsert",
      state: existing.state,
      attemptCount: existing.attemptCount,
    });
    logRc3PhysicalPresenceSmoke("pending");
    const drained = await drainOutbox({
      store: input.store,
      partition: input.partition,
      transport: input.transport ?? defaultTransport(),
    });
    const after = await input.store.getById(existing.outboxId);
    notify(await listPresenceOutboxViews(input.store, input.partition));
    if (after?.state === "acked") {
      logRc3PhysicalPresenceSmoke("ok");
      return {
        outcome: "acked",
        outboxId: existing.outboxId,
        idempotencyKey: existing.idempotencyKey,
        ackedBodies: drained.ackedBodies,
      };
    }
    return {
      outcome: after?.state === "blocked_authorization" ? "blocked_authorization" : "queued",
      outboxId: existing.outboxId,
      idempotencyKey: existing.idempotencyKey,
      ackedBodies: [],
    };
  }

  const enqueued = await enqueueOutboxOperation({
    store: input.store,
    partition: input.partition,
    operationType: "presence.upsert",
    payload: input.payload,
  });
  logRc3PhysicalPresenceSmoke("pending");
  notify(await listPresenceOutboxViews(input.store, input.partition));

  const drained = await drainOutbox({
    store: input.store,
    partition: input.partition,
    transport: input.transport ?? defaultTransport(),
  });
  const row = await input.store.getById(enqueued.outboxId);
  notify(await listPresenceOutboxViews(input.store, input.partition));
  if (row?.state === "acked") {
    logRc3PhysicalPresenceSmoke("ok");
    return {
      outcome: "acked",
      outboxId: enqueued.outboxId,
      idempotencyKey: enqueued.idempotencyKey,
      ackedBodies: drained.ackedBodies,
    };
  }
  if (row?.state === "blocked_authorization") {
    return {
      outcome: "blocked_authorization",
      outboxId: enqueued.outboxId,
      idempotencyKey: enqueued.idempotencyKey,
      ackedBodies: [],
    };
  }
  if (row?.state === "failed_terminal") {
    return {
      outcome: "failed_terminal",
      outboxId: enqueued.outboxId,
      idempotencyKey: enqueued.idempotencyKey,
      ackedBodies: [],
    };
  }
  return {
    outcome: "queued",
    outboxId: enqueued.outboxId,
    idempotencyKey: enqueued.idempotencyKey,
    ackedBodies: [],
  };
}

export async function drainPresenceOutbox(input: {
  store: OutboxStore;
  partition: OutboxPartition;
  transport?: OutboxTransport;
}): Promise<{ processed: number; acked: number; ackedBodies: unknown[] }> {
  const pending = (await listPresenceOutboxViews(input.store, input.partition)).filter(
    (row) => row.state === "pending" || row.state === "in_flight",
  );
  if (!pending.length) {
    logRc3PhysicalPresenceSmoke("empty");
  }
  const result = await drainOutbox({
    store: input.store,
    partition: input.partition,
    transport: input.transport ?? defaultTransport(),
  });
  notify(await listPresenceOutboxViews(input.store, input.partition));
  if (result.acked > 0) logRc3PhysicalPresenceSmoke("ok");
  return result;
}

type SessionLike = {
  user?: { id?: string; schoolId?: string; schoolCode?: string };
  school?: { id?: string; code?: string };
} | null;

async function resolveStoreAndPartition(
  session: SessionLike,
): Promise<{ ok: true; store: OutboxStore; partition: OutboxPartition } | { ok: false }> {
  const resolved = resolveL1Partition(session);
  if (!resolved.ok) return { ok: false };
  const opened = await openNativeL1Database();
  if (!opened.ok) return { ok: false };
  const store = outboxStoreFor(opened.store);
  if (!store?.cipherVersion) return { ok: false };
  return {
    ok: true,
    store,
    partition: { userId: resolved.partition.userId, schoolId: resolved.partition.schoolId },
  };
}

export async function listPresenceOutboxFromSession(session: SessionLike): Promise<
  { ok: true; views: PresenceOutboxView[] } | { ok: false }
> {
  const opened = await resolveStoreAndPartition(session);
  if (!opened.ok) return { ok: false };
  return { ok: true, views: await listPresenceOutboxViews(opened.store, opened.partition) };
}

export async function submitPresenceUpsertFromSession(
  session: SessionLike,
  payload: unknown,
): Promise<PresenceWriteResult> {
  const opened = await resolveStoreAndPartition(session);
  if (!opened.ok) return { outcome: "unavailable", ackedBodies: [] };
  return enqueueAndDrainPresenceUpsert({
    store: opened.store,
    partition: opened.partition,
    payload,
  });
}

export async function drainPresenceOutboxFromSession(session: SessionLike): Promise<{
  processed: number;
  acked: number;
  ackedBodies: unknown[];
} | null> {
  const opened = await resolveStoreAndPartition(session);
  if (!opened.ok) return null;
  return drainPresenceOutbox({ store: opened.store, partition: opened.partition });
}

export function flattenAckedPresenceBodies(bodies: unknown[]): unknown[] {
  const items: unknown[] = [];
  for (const body of bodies) {
    if (Array.isArray(body) && body.length) items.push(...body);
  }
  return items;
}
