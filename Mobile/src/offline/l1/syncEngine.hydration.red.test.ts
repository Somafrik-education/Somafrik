/**
 * CHANTIER SYNC — L1 : tests RED d'hydratation (pas de correctif fonctionnel).
 *   npx --yes tsx src/offline/l1/syncEngine.hydration.red.test.ts
 *
 * Les assertions qui documentent le bug doivent échouer tant que
 * purgeResourceAndReset() efface les lignes avant le snapshot de remplacement.
 */
import assert from "node:assert/strict";
import { createMemoryL1Store } from "./memoryStore";
import { syncL1Cache } from "./syncEngine";
import { resetL1LifecycleForTests } from "./lifecycle";
import type { L1Api, L1Page, L1Partition, L1Resource } from "./types";

const partitionA: L1Partition = { userId: "user-a", schoolId: "school-a", schoolCode: "CD-IN-26-001" };
const partitionB: L1Partition = { userId: "user-a", schoolId: "school-b", schoolCode: "BI-EC-26-001" };
const READY_COUNT = 24;

function collapseCounts(history: number[]): string {
  const collapsed: number[] = [];
  for (const value of history) {
    if (collapsed.length === 0 || collapsed[collapsed.length - 1] !== value) collapsed.push(value);
  }
  return collapsed.join(" → ");
}

function page(resource: L1Resource, items: L1Page["items"], extra: Partial<L1Page> = {}): L1Page {
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

function studentItems(count: number, prefix = "stu") {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    tombstone: false as const,
  }));
}

function httpError(status: number, code: string): Error {
  const error = new Error(code) as Error & { status: number; code: string };
  error.status = status;
  error.code = code;
  return error;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

async function seedReadyStudents(count = READY_COUNT) {
  const store = createMemoryL1Store();
  await store.migrate();
  for (const item of studentItems(count)) {
    await store.upsertRow("students", partitionA, { id: item.id, first_name: item.id });
  }
  await store.putMeta({
    ...partitionA,
    resource: "students",
    cursor: "ready-cursor",
    scopeHash: "scope-a",
    state: "ready",
    schemaVersion: 1,
    lastSuccessAt: "2026-09-06T00:00:00.000Z",
  });
  return store;
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("timeout waitFor");
}

async function delayedFullPage(hold: ReturnType<typeof deferred<void>>, extra: Partial<L1Page> = {}) {
  await hold.promise;
  return page("students", studentItems(READY_COUNT), {
    mode: "full",
    nextCursor: "fresh",
    hasMore: false,
    scopeHash: "scope-a",
    ...extra,
  });
}

async function assertNoPrematurePurge(
  label: string,
  firstPage: (cursor: string | null) => Promise<L1Page>,
) {
  const store = await seedReadyStudents();
  const holdReplacement = deferred<void>();
  const history: number[] = [(await store.listRows("students", partitionA)).length];
  let replacementFetchStarted = false;
  const syncPromise = syncL1Cache({
    store,
    api: apiFor({
      students: async (cursor) => {
        if (cursor === "ready-cursor") return firstPage(cursor);
        replacementFetchStarted = true;
        return delayedFullPage(holdReplacement, { scopeHash: cursor ? "scope-next" : "scope-a" });
      },
    }),
    partition: partitionA,
    isCurrent: () => true,
  });
  try {
    await waitFor(async () => replacementFetchStarted);
    const during = (await store.listRows("students", partitionA)).length;
    history.push(during);
    const transition = collapseCounts(history);
    assert.equal((await store.getMeta(partitionA, "students"))?.state, "ready");
    assert.equal(
      during,
      READY_COUNT,
      `${label}: L1 rows doivent rester disponibles jusqu'au snapshot atomique. Observé: ${transition} (attendu 24 → 24 pendant attente réseau, pas 24 → purge)`,
    );
  } finally {
    holdReplacement.resolve();
    await syncPromise.catch(() => undefined);
  }
}

async function run() {
  const failures: Array<{ name: string; error: unknown }> = [];

  async function runCase(name: string, fn: () => Promise<void>) {
    resetL1LifecycleForTests();
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push({ name, error });
      console.error(`FAIL ${name}`);
      console.error(error);
    }
  }

  await runCase("GREEN 6-L1 5xx conserve 24 → 24", async () => {
    const store = await seedReadyStudents();
    const result = await syncL1Cache({
      store,
      api: apiFor({
        students: async () => {
          throw httpError(503, "BACKEND_5XX");
        },
      }),
      partition: partitionA,
      isCurrent: () => true,
    });
    assert.equal(result.find((row) => row.resource === "students")?.outcome, "error");
    assert.equal((await store.listRows("students", partitionA)).length, READY_COUNT);
    assert.equal((await store.getMeta(partitionA, "students"))?.state, "ready");
  });

  await runCase("GREEN 6-L1 NETWORK_UNAVAILABLE conserve 24 → 24", async () => {
    const store = await seedReadyStudents();
    const result = await syncL1Cache({
      store,
      api: apiFor({
        students: async () => {
          throw httpError(0, "NETWORK_UNAVAILABLE");
        },
      }),
      partition: partitionA,
      isCurrent: () => true,
    });
    assert.equal(result.find((row) => row.resource === "students")?.outcome, "network_preserved");
    assert.equal((await store.listRows("students", partitionA)).length, READY_COUNT);
  });

  await runCase("GREEN 8-L1 A stale n'écrase pas B", async () => {
    const store = createMemoryL1Store();
    await store.migrate();
    const holdA = deferred<void>();
    let generation = 1;
    const syncA = syncL1Cache({
      store,
      api: apiFor({
        default: async (resource) => {
          if (resource === "students") await holdA.promise;
          return page(resource, studentItems(3, `a-${resource}`), {
            nextCursor: `a-${resource}`,
            scopeHash: "scope-a",
          });
        },
      }),
      partition: partitionA,
      isCurrent: () => generation === 1,
    });
    generation = 2;
    await syncL1Cache({
      store,
      api: apiFor({
        default: async (resource) =>
          page(resource, studentItems(2, `b-${resource}`), {
            nextCursor: `b-${resource}`,
            scopeHash: "scope-b",
          }),
      }),
      partition: partitionB,
      isCurrent: () => generation === 2,
    });
    holdA.resolve();
    await syncA;
    const bStudents = await store.listRows("students", partitionB);
    assert.equal(bStudents.length, 2);
    assert.ok(bStudents.every((row) => String(row.id).startsWith("b-")));
    const aAfter = await store.listRows("students", partitionA);
    assert.equal(aAfter.length, 0, "A invalidé ne doit pas se matérialiser après bascule B");
  });

  await runCase("RED 3-L1 full_required sans purge prématurée", async () => {
    await assertNoPrematurePurge("full_required", async () =>
      page("students", [], {
        mode: "full_required",
        nextCursor: "",
        hasMore: false,
        scopeHash: "scope-a",
      }),
    );
  });

  await runCase("RED 3-L1 SCOPE_CHANGED sans purge prématurée", async () => {
    await assertNoPrematurePurge("SCOPE_CHANGED", async () => {
      throw httpError(409, "MOBILE_SYNC_SCOPE_CHANGED");
    });
  });

  await runCase("RED 3-L1 CURSOR_EXPIRED sans purge prématurée", async () => {
    await assertNoPrematurePurge("CURSOR_EXPIRED", async () => {
      throw httpError(409, "MOBILE_SYNC_CURSOR_EXPIRED");
    });
  });

  if (failures.length) {
    console.error(`syncEngine.hydration.red.test.ts: ${failures.length} cas RED (attendu tant que purgeResourceAndReset précède le snapshot)`);
    process.exitCode = 1;
    return;
  }
  console.log("syncEngine.hydration.red.test.ts: all hydration cases GREEN");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
