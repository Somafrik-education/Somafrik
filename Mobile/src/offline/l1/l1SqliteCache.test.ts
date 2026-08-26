/**
 * Cache SQLite L1 — règles moteur (adapter mémoire injectable).
 *   npx --yes tsx src/offline/l1/l1SqliteCache.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generateL1DbKeyHex, loadOrCreateL1DbKey, openEncryptedL1Database } from "./database";
import { bumpL1Generation, currentL1Generation, resolveL1Partition } from "./lifecycle";
import { createMemoryL1Bucket, createMemoryL1Store } from "./memoryStore";
import { applyL1PageAtomically } from "./repository";
import { FORBIDDEN_L1_COLUMNS, SCHEMA_MIGRATION_V1 } from "./schema";
import { validateL1Page } from "./syncApi";
import { syncL1Cache } from "./syncEngine";
import { L1_ERROR, L1_RESOURCES, type L1Api, type L1Page, type L1Partition, type L1Resource } from "./types";

const ROOT = path.resolve(__dirname, "../../..");
const partitionA: L1Partition = { userId: "user-a", schoolId: "school-a", schoolCode: "SCH-A" };
const partitionB: L1Partition = { userId: "user-b", schoolId: "school-b", schoolCode: "SCH-B" };

function page(
  resource: L1Resource,
  items: L1Page["items"],
  extra: Partial<L1Page> = {},
): L1Page {
  return {
    resource,
    mode: "full",
    cursorStatus: "ok",
    scopeHash: "scope-a",
    items,
    nextCursor: "cursor-1",
    hasMore: false,
    ...extra,
  };
}

function apiFor(
  impl: Partial<Record<L1Resource, (cursor: string | null) => Promise<L1Page>>> & {
    default?: (resource: L1Resource, cursor: string | null) => Promise<L1Page>;
  },
): L1Api {
  return {
    async fetchPage(resource, cursor) {
      if (impl[resource]) return impl[resource]!(cursor);
      if (impl.default) return impl.default(resource, cursor);
      return page(resource, [], { nextCursor: `c-${resource}`, scopeHash: "scope-empty" });
    },
  };
}

function httpError(status: number, code: string): Error {
  const error = new Error(code) as Error & { status: number; code: string };
  error.status = status;
  error.code = code;
  return error;
}

async function run() {
  const src = fs.readFileSync(path.join(ROOT, "src/offline/l1/database.ts"), "utf8");
  const typesSrc = fs.readFileSync(path.join(ROOT, "src/offline/l1/types.ts"), "utf8");
  const appConfig = fs.readFileSync(path.join(ROOT, "app.config.js"), "utf8");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };

  assert.equal(pkg.dependencies["expo-sqlite"], "~16.0.10");
  assert.match(appConfig, /useSQLCipher:\s*true/);
  assert.match(src, /somafrik\.l1DbKeyV1/);
  assert.match(typesSrc, /somafrik\.l1DbKeyV1/);
  assert.equal(/PRAGMA key = 'password'/.test(src), false);
  assert.equal(/hexdeadbeef|hardcoded-db-key/i.test(src), false);
  assert.match(src, /PRAGMA cipher_version/);
  assert.match(typesSrc, /L1_SQLCIPHER_REQUIRED/);
  assert.match(src, /L1_ERROR\.SQLCIPHER_REQUIRED/);
  assert.match(src, /platform === "web"/);
  assert.doesNotMatch(SCHEMA_MIGRATION_V1, /REFERENCES l1_/);
  for (const forbidden of FORBIDDEN_L1_COLUMNS) {
    assert.equal(SCHEMA_MIGRATION_V1.includes(forbidden), false, forbidden);
  }

  const keyStore = new Map<string, string>();
  const key1 = await loadOrCreateL1DbKey(
    {
      getItem: async (key) => keyStore.get(key) ?? null,
      setItem: async (key, value) => {
        keyStore.set(key, value);
      },
    },
    () => generateL1DbKeyHex(() => Uint8Array.from({ length: 32 }, (_, i) => i + 1)),
  );
  const key2 = await loadOrCreateL1DbKey(
    {
      getItem: async (key) => keyStore.get(key) ?? null,
      setItem: async (key, value) => {
        keyStore.set(key, value);
      },
    },
    async () => {
      throw new Error("ne doit pas régénérer");
    },
  );
  assert.equal(key1, key2);
  assert.equal(key1.length, 64);
  assert.equal(key1 === "password", false);

  assert.throws(
    () => createMemoryL1Store({ cipherKey: "alpha", openKey: "beta" }),
    (error: unknown) =>
      Boolean(error && typeof error === "object" && (error as { code?: string }).code === L1_ERROR.CIPHER_KEY_INVALID),
  );

  const web = await openEncryptedL1Database({
    platform: "web",
    openDatabase: async () => {
      throw new Error("web ne doit pas ouvrir SQLite");
    },
    keyStore: {
      getItem: async () => "k",
      setItem: async () => undefined,
    },
    generateKey: async () => "k",
  });
  assert.equal(web.ok, false);
  if (!web.ok) assert.equal(web.code, L1_ERROR.SQLCIPHER_REQUIRED);

  const missingCipher = await openEncryptedL1Database({
    platform: "android",
    openDatabase: async () => ({
      async execAsync() {
        return;
      },
      async runAsync() {
        return;
      },
      async getFirstAsync<T>(_sql?: string, _params?: unknown[]): Promise<T | null> {
        return { cipher_version: "" } as T;
      },
      async getAllAsync() {
        return [];
      },
      async withTransactionAsync<T>(fn: () => Promise<T>) {
        return fn();
      },
      async closeAsync() {
        return;
      },
    }),
    keyStore: {
      getItem: async () => "k",
      setItem: async () => undefined,
    },
    generateKey: async () => "k",
  });
  assert.equal(missingCipher.ok, false);
  if (!missingCipher.ok) assert.equal(missingCipher.code, L1_ERROR.SQLCIPHER_REQUIRED);

  const persist = createMemoryL1Bucket();
  const store = createMemoryL1Store({ cipherKey: "alpha", openKey: "alpha", bucket: persist });
  await store.migrate();
  await store.migrate();
  assert.equal(store.cipherVersion.length > 0, true);

  await store.upsertRow("classes", partitionA, { id: "c1", name: "6ème A", class_code: "CLS-A" });
  assert.equal((await store.getRow("classes", partitionA, "c1"))?.name, "6ème A");
  assert.equal(await store.getRow("classes", partitionB, "c1"), null);
  await store.upsertRow("classes", { ...partitionA, schoolId: "school-b", schoolCode: "SCH-B" }, {
    id: "c1",
    name: "Classe B",
  });
  assert.equal((await store.getRow("classes", partitionA, "c1"))?.name, "6ème A");

  await store.upsertRow("students", partitionA, { id: "c1", first_name: "Léa" });
  assert.equal((await store.getRow("classes", partitionA, "c1"))?.name, "6ème A");
  assert.equal((await store.getRow("students", partitionA, "c1"))?.first_name, "Léa");

  await store.close();
  const reopened = createMemoryL1Store({ cipherKey: "alpha", openKey: "alpha", bucket: persist });
  await reopened.migrate();
  assert.equal((await reopened.getRow("classes", partitionA, "c1"))?.name, "6ème A");
  assert.throws(
    () => createMemoryL1Store({ cipherKey: "alpha", openKey: "wrong", bucket: persist }),
    (error: unknown) =>
      Boolean(error && typeof error === "object" && (error as { code?: string }).code === L1_ERROR.CIPHER_KEY_INVALID),
  );

  const boom = createMemoryL1Store();
  await boom.migrate();
  const originalPut = boom.putMeta.bind(boom);
  boom.putMeta = async () => {
    throw new Error("meta-fail");
  };
  await assert.rejects(() =>
    applyL1PageAtomically(
      boom,
      partitionA,
      "classes",
      page("classes", [{ id: "cx", classCode: "X", tombstone: false }]),
      "ready",
    ),
  );
  boom.putMeta = originalPut;
  assert.equal(await boom.getRow("classes", partitionA, "cx"), null);
  assert.equal(await boom.getMeta(partitionA, "classes"), null);

  await applyL1PageAtomically(
    store,
    partitionA,
    "classes",
    page("classes", [
      { id: "c1", classCode: "CLS-A", name: "6ème A", tombstone: false },
      { id: "c-old", classCode: "OLD", tombstone: true },
    ]),
    "ready",
  );
  await store.upsertRow("classes", partitionA, { id: "c-old", class_code: "OLD" });
  await applyL1PageAtomically(
    store,
    partitionA,
    "classes",
    page("classes", [{ id: "c-old", tombstone: true }]),
    "ready",
  );
  assert.equal(await store.getRow("classes", partitionA, "c-old"), null);

  const coldPages = new Map<string, number>();
  const coldApi = apiFor({
    default: async (resource, cursor) => {
      const n = coldPages.get(resource) ?? 0;
      coldPages.set(resource, n + 1);
      if (!cursor) {
        return page(resource, [{ id: `${resource}-1`, tombstone: false }], {
          mode: "full",
          hasMore: true,
          nextCursor: `${resource}-c1`,
          scopeHash: "full-hash",
        });
      }
      return page(resource, [{ id: `${resource}-2`, tombstone: false }], {
        mode: "delta",
        hasMore: false,
        nextCursor: `${resource}-c2`,
        scopeHash: "full-hash",
      });
    },
  });
  const coldStore = createMemoryL1Store();
  await coldStore.migrate();
  const coldResults = await syncL1Cache({
    store: coldStore,
    api: coldApi,
    partition: partitionA,
    isCurrent: () => true,
  });
  assert.deepEqual(
    coldResults.map((row) => row.outcome),
    L1_RESOURCES.map(() => "ready"),
  );
  assert.equal((await coldStore.listRows("classes", partitionA)).length, 2);
  assert.equal((await coldStore.getMeta(partitionA, "classes"))?.state, "ready");
  assert.equal((await coldStore.getMeta(partitionA, "classes"))?.cursor, "classes-c2");
  assert.equal(coldPages.get("classes"), 2);

  const warmStore = coldStore;
  const warmApi = apiFor({
    default: async (resource, cursor) => {
      assert.ok(cursor, "warm doit présenter le curseur opaque");
      return page(resource, [{ id: `${resource}-3`, tombstone: false }], {
        mode: "delta",
        hasMore: false,
        nextCursor: `${resource}-c3`,
        scopeHash: "full-hash",
      });
    },
  });
  await syncL1Cache({ store: warmStore, api: warmApi, partition: partitionA, isCurrent: () => true });
  assert.equal((await warmStore.listRows("classes", partitionA)).length, 3);

  let scopeCalls = 0;
  const scopeStore = createMemoryL1Store();
  await scopeStore.migrate();
  await scopeStore.putMeta({
    ...partitionA,
    resource: "classes",
    cursor: "stale",
    scopeHash: "old",
    state: "ready",
    schemaVersion: 1,
    lastSuccessAt: "2026-08-26T00:00:00.000Z",
  });
  await scopeStore.upsertRow("classes", partitionA, { id: "old-row", name: "ancien" });
  const scopeApi = apiFor({
    default: async (resource, cursor) => {
      scopeCalls += 1;
      if (cursor === "stale") throw httpError(409, "MOBILE_SYNC_SCOPE_CHANGED");
      return page(resource, [{ id: "fresh", name: "nouveau" }], {
        mode: "full",
        hasMore: false,
        nextCursor: "fresh-c",
        scopeHash: "new-hash",
      });
    },
  });
  await syncL1Cache({ store: scopeStore, api: scopeApi, partition: partitionA, isCurrent: () => true });
  assert.equal(await scopeStore.getRow("classes", partitionA, "old-row"), null);
  assert.ok(await scopeStore.getRow("classes", partitionA, "fresh"));
  assert.equal((await scopeStore.getMeta(partitionA, "classes"))?.state, "ready");

  let expiredCalls = 0;
  const expiredStore = createMemoryL1Store();
  await expiredStore.migrate();
  await expiredStore.putMeta({
    ...partitionA,
    resource: "students",
    cursor: "expired",
    scopeHash: "h",
    state: "ready",
    schemaVersion: 1,
    lastSuccessAt: null,
  });
  const expiredApi = apiFor({
    default: async (resource, cursor) => {
      expiredCalls += 1;
      if (cursor === "expired") throw httpError(409, "MOBILE_SYNC_CURSOR_EXPIRED");
      return page(resource, [{ id: "s1" }], { hasMore: false, nextCursor: "ok", scopeHash: "h2" });
    },
  });
  await syncL1Cache({ store: expiredStore, api: expiredApi, partition: partitionA, isCurrent: () => true });
  assert.ok(await expiredStore.getRow("students", partitionA, "s1"));

  let invalidCalls = 0;
  const invalidStore = createMemoryL1Store();
  await invalidStore.migrate();
  await invalidStore.putMeta({
    ...partitionA,
    resource: "assignments",
    cursor: "bad",
    scopeHash: "h",
    state: "ready",
    schemaVersion: 1,
    lastSuccessAt: null,
  });
  const invalidApi = apiFor({
    default: async (resource, cursor) => {
      invalidCalls += 1;
      if (cursor === "bad") throw httpError(400, "MOBILE_SYNC_CURSOR_INVALID");
      if (!cursor) return page(resource, [{ id: "asg-1" }], { hasMore: false, nextCursor: "ok", scopeHash: "h3" });
      throw httpError(400, "MOBILE_SYNC_CURSOR_INVALID");
    },
  });
  await syncL1Cache({ store: invalidStore, api: invalidApi, partition: partitionA, isCurrent: () => true });
  assert.ok(await invalidStore.getRow("assignments", partitionA, "asg-1"));
  assert.ok(invalidCalls >= 2);
  const loopStore = createMemoryL1Store();
  await loopStore.migrate();
  await loopStore.putMeta({
    ...partitionA,
    resource: "assignments",
    cursor: "bad",
    scopeHash: "h",
    state: "ready",
    schemaVersion: 1,
    lastSuccessAt: null,
  });
  const loopApi = apiFor({
    default: async () => {
      throw httpError(400, "MOBILE_SYNC_CURSOR_INVALID");
    },
  });
  const loopResult = await syncL1Cache({
    store: loopStore,
    api: loopApi,
    partition: partitionA,
    isCurrent: () => true,
  });
  assert.equal(loopResult.find((row) => row.resource === "assignments")?.code, L1_ERROR.CURSOR_INVALID_LOOP);

  const forbiddenStore = createMemoryL1Store();
  await forbiddenStore.migrate();
  const forbiddenApi = apiFor({
    classes: async () => {
      throw httpError(403, "PERMISSION_DENIED");
    },
    default: async (resource) => page(resource, [{ id: `${resource}-ok` }], { hasMore: false, nextCursor: "c" }),
  });
  const forbidden = await syncL1Cache({
    store: forbiddenStore,
    api: forbiddenApi,
    partition: partitionA,
    isCurrent: () => true,
  });
  assert.equal(forbidden.find((row) => row.resource === "classes")?.outcome, "blocked_authorization");
  assert.equal((await forbiddenStore.getMeta(partitionA, "classes"))?.state, "blocked_authorization");
  assert.equal((await forbiddenStore.getMeta(partitionA, "students"))?.state, "ready");

  const unauthStore = createMemoryL1Store();
  await unauthStore.migrate();
  await unauthStore.upsertRow("classes", partitionA, { id: "keep-me" });
  const unauth = await syncL1Cache({
    store: unauthStore,
    api: apiFor({
      default: async () => {
        throw httpError(401, "UNAUTHORIZED");
      },
    }),
    partition: partitionA,
    isCurrent: () => true,
  });
  assert.equal(unauth[0]?.outcome, "error");
  assert.equal(await unauthStore.getRow("classes", partitionA, "keep-me"), null);

  const netStore = createMemoryL1Store();
  await netStore.migrate();
  await netStore.upsertRow("classes", partitionA, { id: "cached" });
  await netStore.putMeta({
    ...partitionA,
    resource: "classes",
    cursor: "c",
    scopeHash: "h",
    state: "ready",
    schemaVersion: 1,
    lastSuccessAt: "t",
  });
  const net = await syncL1Cache({
    store: netStore,
    api: apiFor({
      default: async () => {
        throw httpError(0, "NETWORK_UNAVAILABLE");
      },
    }),
    partition: partitionA,
    isCurrent: () => true,
  });
  assert.equal(net.find((row) => row.resource === "classes")?.outcome, "network_preserved");
  assert.equal((await netStore.getRow("classes", partitionA, "cached"))?.id, "cached");
  assert.equal((await netStore.getMeta(partitionA, "classes"))?.cursor, "c");

  const timeoutStore = createMemoryL1Store();
  await timeoutStore.migrate();
  await timeoutStore.putMeta({
    ...partitionA,
    resource: "classes",
    cursor: "c",
    scopeHash: "h",
    state: "ready",
    schemaVersion: 1,
    lastSuccessAt: "t",
  });
  const timeout = await syncL1Cache({
    store: timeoutStore,
    api: apiFor({
      default: async () => {
        throw httpError(undefined as unknown as number, "TIMEOUT");
      },
    }),
    partition: partitionA,
    isCurrent: () => true,
  });
  assert.equal(timeout.find((row) => row.resource === "classes")?.outcome, "error");
  assert.equal(timeout.find((row) => row.resource === "classes")?.outcome === "network_preserved", false);
  assert.equal((await timeoutStore.getMeta(partitionA, "classes"))?.cursor, "c");
  assert.equal((await timeoutStore.getMeta(partitionA, "classes"))?.state, "ready");

  const fiveHundredStore = createMemoryL1Store();
  await fiveHundredStore.migrate();
  await fiveHundredStore.putMeta({
    ...partitionA,
    resource: "classes",
    cursor: "c500",
    scopeHash: "h",
    state: "ready",
    schemaVersion: 1,
    lastSuccessAt: "t",
  });
  const fiveHundred = await syncL1Cache({
    store: fiveHundredStore,
    api: apiFor({
      default: async () => {
        throw httpError(500, "INTERNAL");
      },
    }),
    partition: partitionA,
    isCurrent: () => true,
  });
  assert.equal(fiveHundred.find((row) => row.resource === "classes")?.outcome, "error");
  assert.equal(fiveHundred.find((row) => row.resource === "classes")?.outcome === "network_preserved", false);
  assert.equal((await fiveHundredStore.getMeta(partitionA, "classes"))?.cursor, "c500");

  const fiveStore = createMemoryL1Store();
  await fiveStore.migrate();
  await fiveStore.putMeta({
    ...partitionA,
    resource: "classes",
    cursor: "c",
    scopeHash: "stored-hash",
    state: "ready",
    schemaVersion: 1,
    lastSuccessAt: "t",
  });
  await fiveStore.upsertRow("classes", partitionA, { id: "stale-row" });
  await syncL1Cache({
    store: fiveStore,
    api: apiFor({
      classes: async (cursor) => {
        if (cursor) {
          return page("classes", [{ id: "unexpected" }], {
            scopeHash: "other-hash",
            hasMore: false,
            nextCursor: "n",
          });
        }
        return page("classes", [{ id: "reconciled" }], {
          scopeHash: "new-hash",
          hasMore: false,
          nextCursor: "ok",
        });
      },
      default: async (resource) => page(resource, [], { hasMore: false, nextCursor: "x", scopeHash: "z" }),
    }),
    partition: partitionA,
    isCurrent: () => true,
  });
  assert.equal(await fiveStore.getRow("classes", partitionA, "unexpected"), null);
  assert.equal(await fiveStore.getRow("classes", partitionA, "stale-row"), null);
  assert.ok(await fiveStore.getRow("classes", partitionA, "reconciled"));

  assert.throws(() => validateL1Page({ resource: "classes" }, "classes"));
  assert.throws(() => validateL1Page({ ...page("students", []), resource: "students" }, "classes"));

  const payloadStore = createMemoryL1Store();
  await payloadStore.migrate();
  await payloadStore.putMeta({
    ...partitionA,
    resource: "classes",
    cursor: "keep-me",
    scopeHash: "h",
    state: "ready",
    schemaVersion: 1,
    lastSuccessAt: "t",
  });
  const payload = await syncL1Cache({
    store: payloadStore,
    api: {
      async fetchPage() {
        return validateL1Page({ resource: "classes" }, "classes");
      },
    },
    partition: partitionA,
    isCurrent: () => true,
  });
  assert.equal(payload.find((row) => row.resource === "classes")?.outcome, "error");
  assert.equal((await payloadStore.getMeta(partitionA, "classes"))?.cursor, "keep-me");

  const missingSchool = resolveL1Partition({
    user: { id: "user-a", schoolCode: "SCH-A" },
    school: { code: "SCH-A" },
  });
  assert.equal(missingSchool.ok, false);
  if (!missingSchool.ok) assert.equal(missingSchool.code, L1_ERROR.SCHOOL_ID_REQUIRED);

  const okPartition = resolveL1Partition({
    user: { id: "user-a" },
    school: { id: "school-a", code: "SCH-A" },
  });
  assert.equal(okPartition.ok, true);

  let hangResolve: ((page: L1Page) => void) | undefined;
  let hangReady!: () => void;
  const hangStarted = new Promise<void>((resolve) => {
    hangReady = resolve;
  });
  const hangStore = createMemoryL1Store();
  await hangStore.migrate();
  const hangApi = apiFor({
    default: async (resource) => {
      if (resource !== "classes") {
        return page(resource, [], { hasMore: false, nextCursor: "x", scopeHash: "h" });
      }
      return new Promise<L1Page>((resolve) => {
        hangResolve = resolve;
        hangReady();
      });
    },
  });
  const gen = bumpL1Generation();
  const hangPromise = syncL1Cache({
    store: hangStore,
    api: hangApi,
    partition: partitionA,
    isCurrent: () => currentL1Generation() === gen,
  });
  await hangStarted;
  bumpL1Generation();
  await hangStore.purgePartition(partitionA);
  hangResolve?.(page("classes", [{ id: "late-a", name: "trop tard" }], { hasMore: false, nextCursor: "late" }));
  await hangPromise;
  assert.equal(await hangStore.getRow("classes", partitionA, "late-a"), null);

  console.log("l1SqliteCache.test.ts: OK key/sqlcipher/partition/atomic/tombstone/protocol/fail-closed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
