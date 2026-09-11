/**
 * RC3-1 — Outbox SQLCipher + replay exactly-once (tests A–S).
 *   npx --yes tsx src/offline/outbox/sqliteOutbox.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateL1DbKeyHex, openEncryptedL1Database, outboxStoreFor, type L1SqliteLike } from "../l1/database";
import { L1_ERROR } from "../l1/types";
import {
  ackOutboxOperation,
  claimNextOutboxOperation,
  drainOutbox,
  enqueueOutboxOperation,
  reclaimExpiredLeases,
} from "./engine";
import { hashOutboxPayload } from "./hash";
import { logRc3Outbox, RC3_OUTBOX_TAG } from "./logs";
import { createMemoryOutboxBucket, createMemoryOutboxStore } from "./memoryStore";
import { resolveOutboxOperation } from "./registry";
import {
  OUTBOX_ERROR,
  OUTBOX_REPLAY_HORIZON_MS,
  SERVER_OFFLINE_IDEMPOTENCY_TTL_MS,
  type OutboxPartition,
  type OutboxRow,
  type OutboxStore,
  type OutboxTransport,
  type OutboxTransportResult,
} from "./types";

const ROOT = path.resolve(__dirname, "../../..");
const partitionA: OutboxPartition = { userId: "user-a", schoolId: "school-a" };
const partitionB: OutboxPartition = { userId: "user-b", schoolId: "school-a" };
const partitionA2: OutboxPartition = { userId: "user-a", schoolId: "school-b" };
const presencePayload = {
  items: [{ studentId: "stu-1", status: "present", date: "2026-08-27" }],
};

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `00000000-0000-4000-8000-${String(keySeq).padStart(12, "0")}`;
}

function memoryStore(options?: { cipherVersion?: string; bucket?: ReturnType<typeof createMemoryOutboxBucket> }): OutboxStore {
  return createMemoryOutboxStore({
    cipherVersion: options?.cipherVersion ?? "4.7.0 community",
    bucket: options?.bucket,
  });
}

type PresenceRecord = { hash: string; body: { id: string } };

function createPresenceBackend(): OutboxTransport & { mutations: number; keys: string[]; records: Map<string, PresenceRecord> } {
  const records = new Map<string, PresenceRecord>();
  const keys: string[] = [];
  const backend = {
    mutations: 0,
    keys,
    records,
    async send(input: {
      operationType: string;
      method: "POST" | "PUT" | "PATCH" | "DELETE";
      path: string;
      payload: unknown;
      idempotencyKey: string;
    }): Promise<OutboxTransportResult> {
      keys.push(input.idempotencyKey);
      const hash = await hashOutboxPayload(input.payload);
      const existing = records.get(input.idempotencyKey);
      if (existing) {
        if (existing.hash !== hash) {
          return { status: 409, code: "IDEMPOTENCY_KEY_REUSED" };
        }
        return { status: 201, body: { ...existing.body, idempotentReplay: true } };
      }
      backend.mutations += 1;
      const body = { id: `pre-${backend.mutations}` };
      records.set(input.idempotencyKey, { hash, body });
      return { status: 201, body };
    },
  };
  return backend;
}

function codedTransport(status: number, code: string): OutboxTransport {
  return {
    async send() {
      return { status, code };
    },
  };
}

type SqlOutboxRow = {
  outbox_id: string;
  idempotency_key: string;
  user_id: string;
  school_id: string;
  operation_type: string;
  payload_json: string;
  payload_hash: string;
  state: string;
  attempt_count: number;
  next_attempt_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
  acked_at: string | null;
};

function sortOutbox(rows: SqlOutboxRow[]): SqlOutboxRow[] {
  return [...rows].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.outbox_id < b.outbox_id ? -1 : 1;
  });
}

function createFakeOutboxSqlCipher(cipherVersion = "4.7.0 community") {
  const file = {
    expectedKey: null as string | null,
    schemaVersion: null as number | null,
    outbox: new Map<string, SqlOutboxRow>(),
  };
  const opens: Array<{ name: string; useNewConnection: boolean }> = [];
  let sharedMain: L1SqliteLike | null = null;

  function parsePragmaKey(sql: string): string | null {
    const match = sql.match(/^\s*PRAGMA key\s*=\s*'((?:''|[^'])*)'\s*;?\s*$/i);
    return match ? match[1].replace(/''/g, "'") : null;
  }

  function createConnection(useNewConnection: boolean): L1SqliteLike {
    const state = {
      keyed: false,
      appliedKey: null as string | null,
      closed: false,
      inTxn: false,
      pending: null as Map<string, SqlOutboxRow> | null,
    };

    function rows(): Map<string, SqlOutboxRow> {
      return state.inTxn && state.pending ? state.pending : file.outbox;
    }

    function assertKeyed(sql: string) {
      if (state.closed) throw new Error("connection closed");
      if (parsePragmaKey(sql) != null || /PRAGMA cipher_version/i.test(sql)) return;
      if (!state.keyed) {
        const error = new Error("file is not a database") as Error & { code: string };
        error.code = L1_ERROR.UNLOCK_FAILED;
        throw error;
      }
      if (file.expectedKey && state.appliedKey !== file.expectedKey) {
        const error = new Error("file is not a database") as Error & { code: string };
        error.code = L1_ERROR.UNLOCK_FAILED;
        throw error;
      }
    }

    return {
      async execAsync(sql: string) {
        const key = parsePragmaKey(sql);
        if (key != null) {
          state.keyed = true;
          state.appliedKey = key;
          if (!file.expectedKey) file.expectedKey = key;
          return;
        }
        assertKeyed(sql);
        if (/^BEGIN/i.test(sql)) {
          state.inTxn = true;
          state.pending = new Map([...file.outbox.entries()].map(([id, row]) => [id, { ...row }]));
          return;
        }
        if (/^COMMIT/i.test(sql)) {
          if (state.pending) file.outbox = state.pending;
          state.pending = null;
          state.inTxn = false;
          return;
        }
        if (/^ROLLBACK/i.test(sql)) {
          state.pending = null;
          state.inTxn = false;
        }
      },
      async runAsync(sql: string, params: unknown[] = []) {
        assertKeyed(sql);
        if (/INSERT OR REPLACE INTO schema_migrations/.test(sql)) {
          file.schemaVersion = Number(params[0]);
          return;
        }
        if (/INSERT INTO l1_outbox/.test(sql)) {
          const row: SqlOutboxRow = {
            outbox_id: String(params[0]),
            idempotency_key: String(params[1]),
            user_id: String(params[2]),
            school_id: String(params[3]),
            operation_type: String(params[4]),
            payload_json: String(params[5]),
            payload_hash: String(params[6]),
            state: String(params[7]),
            attempt_count: Number(params[8]) || 0,
            next_attempt_at: params[9] == null ? null : String(params[9]),
            lease_owner: params[10] == null ? null : String(params[10]),
            lease_expires_at: params[11] == null ? null : String(params[11]),
            last_error_code: params[12] == null ? null : String(params[12]),
            created_at: String(params[13]),
            updated_at: String(params[14]),
            acked_at: params[15] == null ? null : String(params[15]),
          };
          rows().set(row.outbox_id, row);
          return;
        }
        if (/SET state = 'in_flight'/.test(sql)) {
          const id = String(params[3]);
          const current = rows().get(id);
          if (!current || current.state !== "pending") return;
          rows().set(id, {
            ...current,
            state: "in_flight",
            lease_owner: String(params[0]),
            lease_expires_at: String(params[1]),
            attempt_count: current.attempt_count + 1,
            updated_at: String(params[2]),
          });
          return;
        }
        if (/lease_owner = NULL/.test(sql) && /state = 'pending'/.test(sql)) {
          const nowIso = String(params[0]);
          const cutoff = String(params[1]);
          for (const row of rows().values()) {
            if (row.state !== "in_flight") continue;
            if (row.lease_expires_at && row.lease_expires_at > cutoff) continue;
            rows().set(row.outbox_id, {
              ...row,
              state: "pending",
              lease_owner: null,
              lease_expires_at: null,
              updated_at: nowIso,
            });
          }
          return;
        }
        if (/OUTBOX_HORIZON_EXPIRED/.test(sql)) {
          const nowIso = String(params[0]);
          const userId = String(params[1]);
          const schoolId = String(params[2]);
          const cutoff = String(params[3]);
          for (const row of rows().values()) {
            if (row.user_id !== userId || row.school_id !== schoolId) continue;
            if (row.state === "acked" || row.state === "failed_terminal") continue;
            if (row.created_at >= cutoff) continue;
            rows().set(row.outbox_id, {
              ...row,
              state: "failed_terminal",
              last_error_code: "OUTBOX_HORIZON_EXPIRED",
              lease_owner: null,
              lease_expires_at: null,
              updated_at: nowIso,
            });
          }
          return;
        }
        if (/UPDATE l1_outbox SET/.test(sql) && /WHERE outbox_id = \?/.test(sql)) {
          const id = String(params[8]);
          const current = rows().get(id);
          if (!current) return;
          rows().set(id, {
            ...current,
            state: String(params[0]),
            attempt_count: Number(params[1]) || 0,
            next_attempt_at: params[2] == null ? null : String(params[2]),
            lease_owner: params[3] == null ? null : String(params[3]),
            lease_expires_at: params[4] == null ? null : String(params[4]),
            last_error_code: params[5] == null ? null : String(params[5]),
            updated_at: String(params[6]),
            acked_at: params[7] == null ? null : String(params[7]),
          });
        }
      },
      async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
        if (/PRAGMA cipher_version/i.test(sql)) {
          return { cipher_version: cipherVersion } as T;
        }
        assertKeyed(sql);
        if (/schema_migrations/.test(sql)) {
          return file.schemaVersion == null ? null : ({ version: file.schemaVersion } as T);
        }
        if (/FROM l1_outbox WHERE outbox_id = \?/.test(sql)) {
          return (rows().get(String(params[0])) ?? null) as T | null;
        }
        if (/FROM l1_outbox WHERE idempotency_key = \?/.test(sql)) {
          for (const row of rows().values()) {
            if (row.idempotency_key === String(params[0])) return row as T;
          }
          return null;
        }
        if (/state = 'pending'/.test(sql)) {
          const userId = String(params[0]);
          const schoolId = String(params[1]);
          const nowIso = String(params[2]);
          const eligible = sortOutbox([...rows().values()]).filter((row) => {
            if (row.user_id !== userId || row.school_id !== schoolId) return false;
            if (row.state !== "pending") return false;
            if (row.next_attempt_at && row.next_attempt_at > nowIso) return false;
            return true;
          });
          return (eligible[0] ?? null) as T | null;
        }
        return null;
      },
      async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
        assertKeyed(sql);
        if (/state = 'in_flight'/.test(sql)) {
          const cutoff = String(params[0]);
          return [...rows().values()]
            .filter((row) => row.state === "in_flight" && (!row.lease_expires_at || row.lease_expires_at <= cutoff))
            .map((row) => ({ outbox_id: row.outbox_id })) as T[];
        }
        if (/state NOT IN \('acked', 'failed_terminal'\)/.test(sql)) {
          const userId = String(params[0]);
          const schoolId = String(params[1]);
          const cutoff = String(params[2]);
          return [...rows().values()]
            .filter(
              (row) =>
                row.user_id === userId &&
                row.school_id === schoolId &&
                row.state !== "acked" &&
                row.state !== "failed_terminal" &&
                row.created_at < cutoff,
            )
            .map((row) => ({ outbox_id: row.outbox_id })) as T[];
        }
        if (/FROM l1_outbox WHERE user_id = \? AND school_id = \?/.test(sql)) {
          const userId = String(params[0]);
          const schoolId = String(params[1]);
          return sortOutbox(
            [...rows().values()].filter((row) => row.user_id === userId && row.school_id === schoolId),
          ) as T[];
        }
        return [];
      },
      async closeAsync() {
        state.closed = true;
      },
    };
  }

  return {
    opens,
    file,
    async openDatabase(name: string, options?: { useNewConnection?: boolean }) {
      const useNewConnection = options?.useNewConnection === true;
      opens.push({ name, useNewConnection });
      if (!useNewConnection) {
        sharedMain = createConnection(false);
        return sharedMain;
      }
      return createConnection(true);
    },
  };
}

async function enqueuePresence(store: OutboxStore, partition = partitionA, payload: unknown = presencePayload, now?: Date) {
  return enqueueOutboxOperation({
    store,
    partition,
    operationType: "presence.upsert",
    payload,
    now,
    createKey: nextKey,
  });
}

async function run() {
  assert.equal(OUTBOX_REPLAY_HORIZON_MS, 30 * 24 * 60 * 60 * 1000);
  assert.equal(SERVER_OFFLINE_IDEMPOTENCY_TTL_MS, 35 * 24 * 60 * 60 * 1000);
  assert.ok(SERVER_OFFLINE_IDEMPOTENCY_TTL_MS > OUTBOX_REPLAY_HORIZON_MS);
  const spec = resolveOutboxOperation("presence.upsert");
  assert.equal(spec.method, "POST");
  assert.equal(spec.path, "/presences");

  const fake = createFakeOutboxSqlCipher();
  const dbKey = await generateL1DbKeyHex(() => Uint8Array.from({ length: 32 }, (_, i) => i + 3));
  const firstOpen = await openEncryptedL1Database({
    platform: "android",
    openDatabase: (name, options) => fake.openDatabase(name, options),
    keyStore: {
      getItem: async () => dbKey,
      setItem: async () => undefined,
    },
    generateKey: async () => dbKey,
  });
  assert.equal(firstOpen.ok, true);
  if (!firstOpen.ok) throw new Error("SQLCipher fake");
  const sqlStore = outboxStoreFor(firstOpen.store);
  assert.ok(sqlStore);
  assert.equal(sqlStore.kind, "sqlcipher");
  assert.match(sqlStore.cipherVersion, /4\./);

  // A — enqueue persiste après close/reopen SQLCipher
  const enqueued = await enqueuePresence(sqlStore, partitionA, presencePayload, new Date("2026-08-01T00:00:00.000Z"));
  const afterInsert = await sqlStore.getByIdempotencyKey(enqueued.idempotencyKey);
  assert.equal(afterInsert?.state, "pending");
  assert.equal(afterInsert?.payloadJson.includes("Authorization"), false);
  assert.equal(afterInsert?.payloadJson.includes("https://"), false);
  await firstOpen.store.close();

  const secondOpen = await openEncryptedL1Database({
    platform: "android",
    openDatabase: (name, options) => fake.openDatabase(name, options),
    keyStore: {
      getItem: async () => dbKey,
      setItem: async () => undefined,
    },
    generateKey: async () => dbKey,
  });
  assert.equal(secondOpen.ok, true);
  if (!secondOpen.ok) throw new Error("reopen");
  const reopened = outboxStoreFor(secondOpen.store);
  assert.ok(reopened);
  const persisted = await reopened.getByIdempotencyKey(enqueued.idempotencyKey);
  assert.equal(persisted?.state, "pending");
  assert.equal(persisted?.idempotencyKey, enqueued.idempotencyKey);
  assert.equal(persisted?.operationType, "presence.upsert");

  // B — kill avant premier send => toujours pending
  const beforeSend = await reopened.listByPartition(partitionA);
  assert.equal(beforeSend.every((row) => row.state === "pending"), true);
  assert.equal(beforeSend.length, 1);

  // N — rollback SQLite : état cohérent
  await assert.rejects(() =>
    reopened.withExclusiveTransaction(async (txn) => {
      await txn.insert({
        outboxId: "obx-rollback",
        idempotencyKey: nextKey(),
        userId: partitionA.userId,
        schoolId: partitionA.schoolId,
        operationType: "presence.upsert",
        payloadJson: "{}",
        payloadHash: "hash",
        state: "pending",
        attemptCount: 0,
        nextAttemptAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        createdAt: "2026-08-01T00:00:01.000Z",
        updatedAt: "2026-08-01T00:00:01.000Z",
        ackedAt: null,
      });
      throw new Error("force-rollback");
    }),
  );
  assert.equal(await reopened.getById("obx-rollback"), null);

  const mem = memoryStore();
  const backend = createPresenceBackend();

  // B/memory — enqueue sans drain
  const queued = await enqueuePresence(mem);
  assert.equal((await mem.getById(queued.outboxId))?.state, "pending");
  assert.equal(backend.mutations, 0);

  // C — serveur commit puis crash client avant ack
  let t = new Date("2026-08-02T00:00:00.000Z");
  await assert.rejects(() =>
    drainOutbox({
      store: mem,
      partition: partitionA,
      transport: backend,
      now: () => t,
      workerId: "worker-c",
      leaseMs: 1000,
      afterSend: async () => {
        throw new Error("crash-before-ack");
      },
    }),
  );
  assert.equal(backend.mutations, 1);
  assert.equal((await mem.getById(queued.outboxId))?.state, "in_flight");
  assert.equal((await mem.getById(queued.outboxId))?.idempotencyKey, queued.idempotencyKey);
  t = new Date("2026-08-02T00:00:02.000Z");
  const replay = await drainOutbox({
    store: mem,
    partition: partitionA,
    transport: backend,
    now: () => t,
    workerId: "worker-c2",
    leaseMs: 1000,
  });
  assert.equal(backend.mutations, 1, "C : un seul effet métier");
  assert.equal(replay.acked, 1);
  assert.equal((await mem.getById(queued.outboxId))?.state, "acked");
  assert.deepEqual(backend.keys, [queued.idempotencyKey, queued.idempotencyKey]);

  // D — même key + même payload => replay succès
  const sameKeyStore = memoryStore();
  const same = await enqueuePresence(sameKeyStore);
  const dBackend = createPresenceBackend();
  await drainOutbox({ store: sameKeyStore, partition: partitionA, transport: dBackend });
  const claimedGone = await claimNextOutboxOperation({ store: sameKeyStore, partition: partitionA });
  assert.equal(claimedGone, null);
  const replayBody = await dBackend.send({
    operationType: "presence.upsert",
    method: "POST",
    path: "/presences",
    payload: presencePayload,
    idempotencyKey: same.idempotencyKey,
  });
  assert.equal((replayBody.body as { idempotentReplay?: boolean }).idempotentReplay, true);
  assert.equal(dBackend.mutations, 1);

  // E — même key + payload différent => IDEMPOTENCY_KEY_REUSED fail closed
  const conflict = await dBackend.send({
    operationType: "presence.upsert",
    method: "POST",
    path: "/presences",
    payload: { items: [{ studentId: "stu-9", status: "absent", date: "2026-08-27" }] },
    idempotencyKey: same.idempotencyKey,
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, "IDEMPOTENCY_KEY_REUSED");
  const eStore = memoryStore();
  const eRow = await enqueuePresence(eStore);
  const eDrain = await drainOutbox({
    store: eStore,
    partition: partitionA,
    transport: {
      async send() {
        return { status: 409, code: "IDEMPOTENCY_KEY_REUSED" };
      },
    },
  });
  assert.equal(eDrain.acked, 0);
  const eAfter = await eStore.getById(eRow.outboxId);
  assert.equal(eAfter?.state, "failed_terminal");
  assert.equal(eAfter?.lastErrorCode, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(eAfter?.idempotencyKey, eRow.idempotencyKey);

  async function classifyCase(label: string, status: number, code: string, expectedState: string) {
    const store = memoryStore();
    const row = await enqueuePresence(store);
    await drainOutbox({ store, partition: partitionA, transport: codedTransport(status, code) });
    const after = await store.getById(row.outboxId);
    assert.equal(after?.state, expectedState, label);
    assert.ok(after, label);
    return after as OutboxRow;
  }

  // F NETWORK_UNAVAILABLE => pending conservé
  const f = await classifyCase("F", 0, "NETWORK_UNAVAILABLE", "pending");
  assert.equal(f.lastErrorCode, "NETWORK_UNAVAILABLE");

  // G TIMEOUT => même key au retry
  const gStore = memoryStore();
  const gRow = await enqueuePresence(gStore);
  let gAttempt = 0;
  const gKeys: string[] = [];
  await drainOutbox({
    store: gStore,
    partition: partitionA,
    now: () => new Date("2026-08-03T00:00:00.000Z"),
    transport: {
      async send(input) {
        gKeys.push(input.idempotencyKey);
        gAttempt += 1;
        return { status: 0, code: "TIMEOUT" };
      },
    },
  });
  await drainOutbox({
    store: gStore,
    partition: partitionA,
    now: () => new Date("2026-08-03T00:10:00.000Z"),
    transport: {
      async send(input) {
        gKeys.push(input.idempotencyKey);
        gAttempt += 1;
        return { status: 201, body: { id: "pre-timeout" } };
      },
    },
  });
  assert.equal(gAttempt, 2, "G");
  assert.deepEqual(gKeys, [gRow.idempotencyKey, gRow.idempotencyKey]);
  assert.equal((await gStore.getById(gRow.outboxId))?.state, "acked");

  // H 5xx => pending
  const h = await classifyCase("H", 503, "BACKEND_5XX", "pending");
  assert.equal(h.lastErrorCode, "BACKEND_5XX");

  // I 401/403 => blocked_authorization, pas de suppression
  const i401 = await classifyCase("I401", 401, "UNAUTHORIZED", "blocked_authorization");
  assert.equal(i401.state, "blocked_authorization");
  const iStore = memoryStore();
  const iRow = await enqueuePresence(iStore);
  await drainOutbox({ store: iStore, partition: partitionA, transport: codedTransport(403, "FORBIDDEN") });
  const iAfter = await iStore.getById(iRow.outboxId);
  assert.equal(iAfter?.state, "blocked_authorization");
  assert.equal(iAfter?.lastErrorCode, "FORBIDDEN");
  assert.equal((await iStore.listByPartition(partitionA)).length, 1);

  // J changement userId => 0 replay
  const isoStore = memoryStore();
  await enqueuePresence(isoStore, partitionA);
  const j = await drainOutbox({
    store: isoStore,
    partition: partitionB,
    transport: createPresenceBackend(),
  });
  assert.equal(j.processed, 0);
  assert.equal((await isoStore.listByPartition(partitionA))[0]?.state, "pending");

  // K changement schoolId => 0 replay
  const k = await drainOutbox({
    store: isoStore,
    partition: partitionA2,
    transport: createPresenceBackend(),
  });
  assert.equal(k.processed, 0);
  assert.equal((await isoStore.listByPartition(partitionA))[0]?.state, "pending");

  // L stale lease après restart => reclaim
  const leaseStore = memoryStore();
  const leaseRow = await enqueuePresence(leaseStore);
  const claimed = await claimNextOutboxOperation({
    store: leaseStore,
    partition: partitionA,
    workerId: "dead-worker",
    now: new Date("2026-08-04T00:00:00.000Z"),
    leaseMs: 1000,
  });
  assert.equal(claimed?.state, "in_flight");
  const reclaimed = await reclaimExpiredLeases(leaseStore, new Date("2026-08-04T00:00:02.000Z"));
  assert.equal(reclaimed, 1);
  assert.equal((await leaseStore.getById(leaseRow.outboxId))?.state, "pending");
  assert.equal((await leaseStore.getById(leaseRow.outboxId))?.leaseOwner, null);

  // M 2 workers concurrents => une seule claim
  const conc = memoryStore();
  await enqueuePresence(conc);
  const [w1, w2] = await Promise.all([
    claimNextOutboxOperation({ store: conc, partition: partitionA, workerId: "w1" }),
    claimNextOutboxOperation({ store: conc, partition: partitionA, workerId: "w2" }),
  ]);
  const owners = [w1, w2].filter(Boolean);
  assert.equal(owners.length, 1, "M : une seule claim");
  assert.equal((await conc.listByPartition(partitionA)).filter((row) => row.state === "in_flight").length, 1);

  // O ordre déterministe created_at ASC, outbox_id ASC
  const orderStore = memoryStore();
  const t0 = new Date("2026-08-05T00:00:00.000Z");
  const first = await enqueuePresence(orderStore, partitionA, presencePayload, t0);
  const second = await enqueuePresence(orderStore, partitionA, { items: [{ studentId: "stu-2", status: "present", date: "2026-08-27" }] }, t0);
  const firstClaim = await claimNextOutboxOperation({ store: orderStore, partition: partitionA, now: t0, workerId: "ord" });
  assert.equal(firstClaim?.outboxId, first.outboxId < second.outboxId ? first.outboxId : second.outboxId);
  await ackOutboxOperation(orderStore, firstClaim!.outboxId, t0);
  const secondClaim = await claimNextOutboxOperation({ store: orderStore, partition: partitionA, now: t0, workerId: "ord" });
  const remaining = firstClaim?.outboxId === first.outboxId ? second.outboxId : first.outboxId;
  assert.equal(secondClaim?.outboxId, remaining);

  // P aucune donnée sensible stockée/loggée
  await assert.rejects(
    () =>
      enqueueOutboxOperation({
        store: memoryStore(),
        partition: partitionA,
        operationType: "presence.upsert",
        payload: { items: [], authorization: "Bearer secret", accessToken: "jwt" },
        createKey: nextKey,
      }),
    (error: unknown) => (error as { code?: string }).code === OUTBOX_ERROR.PAYLOAD_INVALID,
  );
  const logs: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    logRc3Outbox({
      operationType: "presence.upsert",
      state: "pending",
      attemptCount: 1,
      classification: "TIMEOUT",
      retry: true,
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(logs.some((line) => line.includes(RC3_OUTBOX_TAG)));
  assert.equal(logs.some((line) => /payload_json|Bearer|refreshToken|Authorization|l1DbKey/i.test(line)), false);

  const engineSrc = fs.readFileSync(path.join(ROOT, "src/offline/outbox/engine.ts"), "utf8");
  const sqliteSrc = fs.readFileSync(path.join(ROOT, "src/offline/outbox/sqliteStore.ts"), "utf8");
  const v2Src = fs.readFileSync(path.join(ROOT, "src/offline/l1/schema.ts"), "utf8");
  const v2 = v2Src.slice(v2Src.indexOf("SCHEMA_MIGRATION_V2"));
  const logsSrc = fs.readFileSync(path.join(ROOT, "src/offline/outbox/logs.ts"), "utf8");
  assert.doesNotMatch(v2, /access_token|refresh_token|password|jwt/i);
  assert.doesNotMatch(v2, /^\s+authorization\s+/im);
  assert.doesNotMatch(sqliteSrc, /Authorization/);
  assert.match(sqliteSrc, /idempotency_key/);
  assert.doesNotMatch(logsSrc, /payload_json/);
  assert.match(engineSrc, /idempotencyKey: claimed.idempotencyKey/);

  // Q SQLCipher indisponible => fail closed, pas de plaintext
  assert.throws(
    () => createMemoryOutboxStore({ cipherVersion: "" }),
    (error: unknown) => (error as { code?: string }).code === L1_ERROR.SQLCIPHER_REQUIRED,
  );
  const missing = await openEncryptedL1Database({
    platform: "android",
    openDatabase: async () =>
      ({
        async execAsync() {
          return;
        },
        async runAsync() {
          return;
        },
        async getFirstAsync<T>(): Promise<T | null> {
          return { cipher_version: "" } as T;
        },
        async getAllAsync() {
          return [];
        },
        async closeAsync() {
          return;
        },
      }) as L1SqliteLike,
    keyStore: { getItem: async () => "k", setItem: async () => undefined },
    generateKey: async () => "k",
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, L1_ERROR.SQLCIPHER_REQUIRED);
  const web = await openEncryptedL1Database({
    platform: "web",
    openDatabase: async () => {
      throw new Error("web");
    },
    keyStore: { getItem: async () => "k", setItem: async () => undefined },
    generateKey: async () => "k",
  });
  assert.equal(web.ok, false);

  // R opération inconnue => refus
  await assert.rejects(
    () =>
      enqueueOutboxOperation({
        store: memoryStore(),
        partition: partitionA,
        operationType: "student.enroll",
        payload: presencePayload,
        createKey: nextKey,
      }),
    (error: unknown) => (error as { code?: string }).code === OUTBOX_ERROR.UNKNOWN_OPERATION,
  );
  assert.throws(
    () => resolveOutboxOperation("presence.delete"),
    (error: unknown) => (error as { code?: string }).code === OUTBOX_ERROR.UNKNOWN_OPERATION,
  );

  // S horizon expiré => aucun replay, pas de nouvelle clé
  const horizonStore = memoryStore();
  const old = await enqueuePresence(horizonStore, partitionA, presencePayload, new Date("2026-01-01T00:00:00.000Z"));
  const expired = await drainOutbox({
    store: horizonStore,
    partition: partitionA,
    transport: createPresenceBackend(),
    now: () => new Date("2026-02-15T00:00:00.000Z"),
  });
  assert.equal(expired.processed, 0);
  assert.equal(expired.acked, 0);
  const expiredRow = await horizonStore.getById(old.outboxId);
  assert.equal(expiredRow?.state, "failed_terminal");
  assert.equal(expiredRow?.lastErrorCode, "OUTBOX_HORIZON_EXPIRED");
  assert.equal(expiredRow?.idempotencyKey, old.idempotencyKey);

  const screensDir = path.join(ROOT, "src/screens");
  for (const name of fs.readdirSync(screensDir)) {
    if (!/\.(tsx|ts)$/.test(name)) continue;
    const src = fs.readFileSync(path.join(screensDir, name), "utf8");
    assert.doesNotMatch(src, /expo-sqlite/);
    assert.doesNotMatch(src, /offline\/outbox/);
  }

  await secondOpen.store.close();
  console.log("sqliteOutbox.test.ts: OK A-S enqueue/lease/replay/isolation/horizon/sqlcipher");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
