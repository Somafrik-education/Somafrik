/**
 * Marqueurs RC2 Offline Read Smoke — format logcat, pas de PII, OK seulement après boot + 5 L1.
 *   npx --yes tsx src/offline/l1/rc2OfflineReadSmoke.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { snapshotFromL1Cache, snapshotFromSuccess, snapshotL1Unavailable, metricLabelFromSnapshot, METRIC_UNAVAILABLE_LABEL } from "../../lib/dataTruth";
import {
  filterL1AssignmentsForTeacherSession,
  l1AssignmentBelongsToTeacherSession,
} from "../../lib/establishment";
import { createMemoryL1Store } from "./memoryStore";
import {
  loadL1BackedSnapshot,
  readL1Resource,
  setL1ReadDepsForTests,
  shouldBlockUnsupportedMutations,
} from "./readModel";
import { applyL1PageAtomically, markResourceState } from "./repository";
import { resetL1LifecycleForTests } from "./lifecycle";
import {
  logRc2L1Page,
  logRc2L1Read,
  logRc2L1ReadFromSnapshot,
  logRc2L1Refusal,
  logRc2L1Stage,
  logRc2L1Sync,
  logRc2L1SyncException,
  logRc2L1SyncResults,
  logRc2L1SyncStart,
  logRc2OfflineBoot,
  RC2_L1_PAGE_TAG,
  RC2_L1_READ_TAG,
  RC2_L1_REFUSAL_TAG,
  RC2_L1_RESOURCES,
  RC2_L1_STAGE_TAG,
  RC2_L1_SYNC_EXCEPTION_TAG,
  RC2_L1_SYNC_START_TAG,
  RC2_L1_SYNC_TAG,
  RC2_OFFLINE_BOOT_TAG,
  RC2_OFFLINE_READ_SMOKE_TAG,
  resetRc2OfflineReadSmokeForTests,
} from "./rc2OfflineReadSmoke";
import { syncL1Cache } from "./syncEngine";
import type { L1Api, L1Page, L1Partition, L1Resource } from "./types";
import { L1_RESOURCES } from "./types";

const ROOT = path.resolve(__dirname, "../../..");
const L1_READ_LINE = /^RC2_L1_READ resource=[a-z-]+ source=[a-z0-9-]+ status=[a-z]+ rows=\d+$/;
const SYNC_LINE = /^RC2_L1_SYNC resource=[a-z-]+ outcome=[a-z_]+(?: code=[A-Z0-9_]+)?$/;
const SYNC_START_LINE = /^RC2_L1_SYNC_START resource=[a-z-]+$/;
const PAGE_LINE = /^RC2_L1_PAGE resource=[a-z-]+ mode=(full|delta|full_required|unavailable) hasMore=(true|false) page=\d+$/;
const STAGE_LINE = /^RC2_L1_STAGE resource=[a-z-]+ stage=(meta_start|meta_ok|reconcile_start|reconcile_ok|fetch_start|apply_start|apply_ok)$/;
const EXCEPTION_LINE = /^RC2_L1_SYNC_EXCEPTION resource=[a-z-]+(?: stage=(meta|reconcile|fetch|apply))? reason=unexpected$/;
const REFUSAL_LINE = /^RC2_L1_REFUSAL resource=[a-z-]+ reason=[a-z_]+$/;
const BOOT_LINE = /^RC2_OFFLINE_BOOT permissions=ready_offline(?: status=[a-z_]+)?$/;
const OK_LINE = /^RC2_OFFLINE_READ_SMOKE OK$/;
const FORBIDDEN = /jwt|eyJ|password|email|phone|téléphone|userId=|user_id=|matricule|bearer/i;

const partitionA: L1Partition = { userId: "user-a", schoolId: "school-1", schoolCode: "SCH-1" };
const sessionA = {
  user: { id: "user-a", schoolId: "school-1", schoolCode: "SCH-1" },
  school: { id: "school-1", code: "SCH-1" },
};

function page(resource: L1Resource, items: L1Page["items"]): L1Page {
  return {
    resource,
    mode: "full",
    cursorStatus: "ok",
    scopeHash: "scope-a",
    items,
    nextCursor: "cursor-1",
    hasMore: false,
  };
}

async function run() {
  const lines: string[] = [];
  resetRc2OfflineReadSmokeForTests({
    logger: { warn: (message) => lines.push(message) },
  });

  logRc2L1Read({
    resource: "classes",
    source: "l1-cache",
    status: "success",
    rows: 4,
  });
  assert.equal(lines.at(-1), "RC2_L1_READ resource=classes source=l1-cache status=success rows=4");
  assert.match(lines.at(-1) ?? "", L1_READ_LINE);
  assert.doesNotMatch(lines.at(-1) ?? "", FORBIDDEN);

  logRc2L1Read({
    resource: "classes",
    source: "l1-cache",
    status: "success",
    rows: Number.NaN,
  });
  assert.equal(lines.at(-1), "RC2_L1_READ resource=classes source=l1-cache status=success rows=0");

  logRc2L1Read({
    resource: "not-a-resource",
    source: "l1-cache",
    status: "success",
    rows: 9,
  });
  assert.equal(lines.filter((line) => line.includes("not-a-resource")).length, 0);

  logRc2L1Read({
    resource: "students",
    source: "jwt-leak" as never,
    status: "success",
    rows: 87,
  });
  assert.equal(lines.at(-1), "RC2_L1_READ resource=students source=none status=success rows=87");

  logRc2OfflineBoot({ permissions: "ready" });
  assert.equal(lines.some((line) => line.startsWith(RC2_OFFLINE_BOOT_TAG) && line.includes("ready") && !line.includes("ready_offline")), false);

  logRc2OfflineBoot({ permissions: "ready_offline", status: "sqlcipher_unavailable" });
  assert.equal(lines.at(-1), "RC2_OFFLINE_BOOT permissions=ready_offline status=sqlcipher_unavailable");
  assert.match(lines.at(-1) ?? "", BOOT_LINE);
  assert.equal(lines.includes(`${RC2_OFFLINE_READ_SMOKE_TAG} OK`), false, "échec boot ≠ OK");

  resetRc2OfflineReadSmokeForTests({
    logger: { warn: (message) => lines.push(message) },
  });
  lines.length = 0;

  logRc2OfflineBoot({ permissions: "ready_offline" });
  assert.equal(lines.at(-1), "RC2_OFFLINE_BOOT permissions=ready_offline");
  assert.equal(lines.includes(`${RC2_OFFLINE_READ_SMOKE_TAG} OK`), false, "boot seul ≠ OK");

  const counts = [4, 87, 12, 18, 24];
  RC2_L1_RESOURCES.forEach((resource, index) => {
    logRc2L1Read({
      resource,
      source: "l1-cache",
      status: "success",
      rows: counts[index],
    });
  });
  assert.equal(lines.at(-1), `${RC2_OFFLINE_READ_SMOKE_TAG} OK`);
  assert.match(lines.at(-1) ?? "", OK_LINE);
  const okCount = lines.filter((line) => line === `${RC2_OFFLINE_READ_SMOKE_TAG} OK`).length;
  logRc2L1Read({ resource: "classes", source: "l1-cache", status: "success", rows: 4 });
  assert.equal(
    lines.filter((line) => line === `${RC2_OFFLINE_READ_SMOKE_TAG} OK`).length,
    okCount,
    "OK émis une seule fois",
  );

  resetRc2OfflineReadSmokeForTests({
    logger: { warn: (message) => lines.push(message) },
  });
  lines.length = 0;
  logRc2OfflineBoot({ permissions: "ready_offline" });
  logRc2L1Read({ resource: "classes", source: "network", status: "success", rows: 4 });
  for (const resource of RC2_L1_RESOURCES.slice(1)) {
    logRc2L1Read({ resource, source: "l1-cache", status: "success", rows: 1 });
  }
  assert.equal(lines.includes(`${RC2_OFFLINE_READ_SMOKE_TAG} OK`), false, "source=network ne compte pas");

  resetRc2OfflineReadSmokeForTests({
    logger: { warn: (message) => lines.push(message) },
  });
  lines.length = 0;
  logRc2OfflineBoot({ permissions: "ready_offline" });
  for (const resource of RC2_L1_RESOURCES) {
    logRc2L1ReadFromSnapshot(resource, snapshotL1Unavailable());
  }
  assert.equal(lines.includes(`${RC2_OFFLINE_READ_SMOKE_TAG} OK`), false, "offline/unavailable ne compte pas");
  assert.ok(lines.some((line) => line === "RC2_L1_READ resource=classes source=none status=offline rows=0"));

  resetRc2OfflineReadSmokeForTests({
    logger: { warn: (message) => lines.push(message) },
  });
  lines.length = 0;
  logRc2OfflineBoot({ permissions: "ready_offline" });
  for (const resource of RC2_L1_RESOURCES) {
    logRc2L1Read({ resource, source: "l1-cache", status: "empty", rows: 0 });
  }
  assert.equal(lines.at(-1), `${RC2_OFFLINE_READ_SMOKE_TAG} OK`, "ready + 0 rows = vide confirmé, OK");

  resetRc2OfflineReadSmokeForTests({
    logger: { warn: (message) => lines.push(message) },
  });
  lines.length = 0;
  logRc2L1Sync({ resource: "classes", outcome: "ready" });
  assert.equal(lines.at(-1), "RC2_L1_SYNC resource=classes outcome=ready");
  assert.match(lines.at(-1) ?? "", SYNC_LINE);
  logRc2L1Sync({ resource: "students", outcome: "error", code: "UNAUTHORIZED" });
  assert.equal(lines.at(-1), "RC2_L1_SYNC resource=students outcome=error code=UNAUTHORIZED");
  logRc2L1Sync({ resource: "assignments", outcome: "blocked_authorization", code: "PERMISSION_DENIED" });
  assert.equal(lines.at(-1), "RC2_L1_SYNC resource=assignments outcome=blocked_authorization code=PERMISSION_DENIED");
  logRc2L1Sync({ resource: "school-courses", outcome: "error", code: "secret-jwt-value" });
  assert.equal(lines.at(-1), "RC2_L1_SYNC resource=school-courses outcome=error");
  logRc2L1Sync({ resource: "course-schedules", outcome: "not-a-real-outcome" });
  assert.equal(lines.filter((line) => line.includes("not-a-real-outcome")).length, 0);
  logRc2L1SyncResults([
    { resource: "classes", outcome: "ready" },
    { resource: "students", outcome: "network_preserved" },
    { resource: "assignments", outcome: "discarded" },
    { resource: "school-courses", outcome: "error", code: "BACKEND_5XX" },
    { resource: "course-schedules", outcome: "ready" },
  ]);
  assert.ok(lines.includes("RC2_L1_SYNC resource=students outcome=network_preserved"));
  assert.ok(lines.includes("RC2_L1_SYNC resource=school-courses outcome=error code=BACKEND_5XX"));
  for (const line of lines.filter((row) => row.startsWith(RC2_L1_SYNC_TAG))) {
    assert.match(line, SYNC_LINE);
    assert.doesNotMatch(line, FORBIDDEN);
  }

  for (const reason of [
    "empty",
    "reconciling",
    "blocked_authorization",
    "metadata_absent",
    "partition_mismatch",
    "sqlcipher_unavailable",
    "partition_unresolved",
  ] as const) {
    logRc2L1Refusal({ resource: "students", reason });
    assert.equal(lines.at(-1), `RC2_L1_REFUSAL resource=students reason=${reason}`);
    assert.match(lines.at(-1) ?? "", REFUSAL_LINE);
  }
  logRc2L1Refusal({ resource: "students", reason: "jwt-leak" });
  assert.equal(lines.filter((line) => line.includes("jwt-leak")).length, 0);
  logRc2L1Refusal({ resource: "not-a-resource", reason: "metadata_absent" });
  assert.equal(lines.filter((line) => line.includes("not-a-resource")).length, 0);

  logRc2L1SyncStart({ resource: "classes" });
  assert.equal(lines.at(-1), "RC2_L1_SYNC_START resource=classes");
  assert.match(lines.at(-1) ?? "", SYNC_START_LINE);
  logRc2L1Page({ resource: "classes", mode: "full", hasMore: false, page: 1 });
  assert.equal(lines.at(-1), "RC2_L1_PAGE resource=classes mode=full hasMore=false page=1");
  assert.match(lines.at(-1) ?? "", PAGE_LINE);
  logRc2L1Page({ resource: "students", mode: "unavailable", hasMore: true, page: 2 });
  assert.equal(lines.at(-1), "RC2_L1_PAGE resource=students mode=unavailable hasMore=true page=2");
  logRc2L1Page({ resource: "assignments", mode: "secret-mode", hasMore: false, page: 1 });
  assert.equal(lines.filter((line) => line.includes("secret-mode")).length, 0);
  logRc2L1Stage({ resource: "classes", stage: "meta_start" });
  assert.equal(lines.at(-1), "RC2_L1_STAGE resource=classes stage=meta_start");
  assert.match(lines.at(-1) ?? "", STAGE_LINE);
  logRc2L1Stage({ resource: "classes", stage: "meta_ok" });
  logRc2L1Stage({ resource: "classes", stage: "reconcile_start" });
  logRc2L1Stage({ resource: "classes", stage: "reconcile_ok" });
  logRc2L1Stage({ resource: "classes", stage: "fetch_start" });
  logRc2L1Stage({ resource: "classes", stage: "apply_start" });
  logRc2L1Stage({ resource: "classes", stage: "apply_ok" });
  assert.equal(lines.at(-1), "RC2_L1_STAGE resource=classes stage=apply_ok");
  logRc2L1Stage({ resource: "classes", stage: "meta" });
  assert.equal(lines.filter((line) => line === "RC2_L1_STAGE resource=classes stage=meta").length, 0);
  logRc2L1Stage({ resource: "classes", stage: "jwt-leak" });
  assert.equal(lines.filter((line) => line.includes("jwt-leak")).length, 0);
  logRc2L1Stage({ resource: "not-a-resource", stage: "meta_start" });
  assert.equal(lines.filter((line) => line.includes("not-a-resource")).length, 0);
  for (const line of lines.filter((row) => row.startsWith(RC2_L1_STAGE_TAG))) {
    assert.match(line, STAGE_LINE);
    assert.doesNotMatch(line, FORBIDDEN);
  }

  logRc2L1SyncException({ resource: "classes", reason: "unexpected" });
  assert.equal(lines.at(-1), "RC2_L1_SYNC_EXCEPTION resource=classes reason=unexpected");
  assert.match(lines.at(-1) ?? "", EXCEPTION_LINE);
  logRc2L1SyncException({ resource: "classes", reason: "unexpected", stage: "reconcile" });
  assert.equal(lines.at(-1), "RC2_L1_SYNC_EXCEPTION resource=classes stage=reconcile reason=unexpected");
  assert.match(lines.at(-1) ?? "", EXCEPTION_LINE);
  logRc2L1SyncException({ resource: "students", reason: "Error: boom jwt" });
  assert.equal(lines.at(-1), "RC2_L1_SYNC_EXCEPTION resource=students reason=unexpected");
  logRc2L1SyncException({
    resource: "assignments",
    reason: "Error: boom jwt",
    stage: "cursor-sql-userId=",
  });
  assert.equal(lines.at(-1), "RC2_L1_SYNC_EXCEPTION resource=assignments reason=unexpected");
  assert.equal(lines.filter((line) => /boom|jwt|cursor-sql|userId=/i.test(line) && line.startsWith(RC2_L1_SYNC_EXCEPTION_TAG)).length, 0);

  resetL1LifecycleForTests();
  setL1ReadDepsForTests(null);
  const store = createMemoryL1Store();
  await store.migrate();
  setL1ReadDepsForTests({
    openStore: async () => ({ ok: true, store }),
  });
  await applyL1PageAtomically(
    store,
    partitionA,
    "classes",
    page("classes", [{ id: "cls-6a", classCode: "CLS-6A", name: "6ème A", status: "active" }]),
    "ready",
  );

  resetRc2OfflineReadSmokeForTests({
    logger: { warn: (message) => lines.push(message) },
  });
  lines.length = 0;
  logRc2OfflineBoot({ permissions: "ready_offline" });
  const loaded = await loadL1BackedSnapshot({
    session: sessionA,
    permissionsBootstrap: "ready_offline",
    resource: "classes",
    fetchNetwork: async () => {
      throw new Error("GET interdit en ready_offline");
    },
    project: (read) => read.rows.map((row) => ({ id: String(row.id) })),
  });
  assert.equal(loaded.source, "l1-cache");
  assert.equal(loaded.status, "success");
  assert.equal(lines.at(-1), "RC2_L1_READ resource=classes source=l1-cache status=success rows=1");

  await applyL1PageAtomically(
    store,
    partitionA,
    "students",
    page("students", []),
    "ready",
  );
  const emptyStudents = await loadL1BackedSnapshot({
    session: sessionA,
    permissionsBootstrap: "ready_offline",
    resource: "students",
    fetchNetwork: async () => {
      throw new Error("GET interdit en ready_offline");
    },
    project: () => [],
  });
  assert.equal(emptyStudents.source, "l1-cache");
  assert.equal(emptyStudents.status, "empty");
  assert.equal(lines.at(-1), "RC2_L1_READ resource=students source=l1-cache status=empty rows=0");

  const missingMeta = await readL1Resource({ session: sessionA, resource: "assignments" });
  assert.deepEqual(missingMeta, { ok: false, reason: "metadata_absent" });
  assert.equal(lines.at(-1), "RC2_L1_REFUSAL resource=assignments reason=metadata_absent");

  await applyL1PageAtomically(
    store,
    partitionA,
    "assignments",
    page("assignments", [{ id: "asg-1", teacher_user_id: "user-a", status: "active" }]),
    "ready",
  );
  await markResourceState(store, partitionA, "assignments", { state: "reconciling" });
  const reconciling = await readL1Resource({ session: sessionA, resource: "assignments" });
  assert.deepEqual(reconciling, { ok: false, reason: "reconciling" });
  assert.equal(lines.at(-1), "RC2_L1_REFUSAL resource=assignments reason=reconciling");

  const blockedLoad = await loadL1BackedSnapshot({
    session: sessionA,
    permissionsBootstrap: "ready_offline",
    resource: "school-courses",
    fetchNetwork: async () => {
      throw new Error("GET interdit en ready_offline");
    },
    project: () => [],
  });
  assert.equal(blockedLoad.status, "offline");
  assert.ok(lines.includes("RC2_L1_REFUSAL resource=school-courses reason=metadata_absent"));
  assert.equal(lines.at(-1), "RC2_L1_READ resource=school-courses source=none status=offline rows=0");

  const hits: Record<string, number> = {};
  const sequentialApi: L1Api = {
    async fetchPage(resource) {
      hits[resource] = (hits[resource] ?? 0) + 1;
      if (resource === "classes" && hits[resource] === 1) {
        return {
          resource,
          mode: "unavailable",
          cursorStatus: "ok",
          scopeHash: "h",
          items: [],
          nextCursor: "",
          hasMore: false,
        } satisfies L1Page;
      }
      return {
        resource,
        mode: "full",
        cursorStatus: "ok",
        scopeHash: "h",
        items: [{ id: `${resource}-1` }],
        nextCursor: "c",
        hasMore: false,
      } satisfies L1Page;
    },
  };
  resetRc2OfflineReadSmokeForTests({
    logger: { warn: (message) => lines.push(message) },
  });
  lines.length = 0;
  const syncStore = createMemoryL1Store();
  await syncStore.migrate();
  const syncResults = await syncL1Cache({
    store: syncStore,
    api: sequentialApi,
    partition: partitionA,
    isCurrent: () => true,
  });
  const startIdx = lines.findIndex((line) => line === "RC2_L1_SYNC_START resource=classes");
  const metaStartIdx = lines.findIndex((line) => line === "RC2_L1_STAGE resource=classes stage=meta_start");
  const metaOkIdx = lines.findIndex((line) => line === "RC2_L1_STAGE resource=classes stage=meta_ok");
  const reconcileStartIdx = lines.findIndex(
    (line) => line === "RC2_L1_STAGE resource=classes stage=reconcile_start",
  );
  const reconcileOkIdx = lines.findIndex((line) => line === "RC2_L1_STAGE resource=classes stage=reconcile_ok");
  const fetchStartIdx = lines.findIndex((line) => line === "RC2_L1_STAGE resource=classes stage=fetch_start");
  const pageUnavailableIdx = lines.findIndex(
    (line) => line === "RC2_L1_PAGE resource=classes mode=unavailable hasMore=false page=1",
  );
  const pageFullIdx = lines.findIndex(
    (line) => line === "RC2_L1_PAGE resource=classes mode=full hasMore=false page=2",
  );
  const applyStartIdx = lines.findIndex((line) => line === "RC2_L1_STAGE resource=classes stage=apply_start");
  const applyOkIdx = lines.findIndex((line) => line === "RC2_L1_STAGE resource=classes stage=apply_ok");
  const syncClassesIdx = lines.findIndex((line) => line === "RC2_L1_SYNC resource=classes outcome=ready");
  const startStudentsIdx = lines.findIndex((line) => line === "RC2_L1_SYNC_START resource=students");
  assert.ok(startIdx >= 0);
  assert.ok(metaStartIdx > startIdx);
  assert.ok(metaOkIdx > metaStartIdx);
  assert.ok(reconcileStartIdx > metaOkIdx);
  assert.ok(reconcileOkIdx > reconcileStartIdx);
  assert.ok(fetchStartIdx > reconcileOkIdx);
  assert.ok(pageUnavailableIdx > fetchStartIdx, "PAGE unavailable avant outcome");
  assert.ok(pageFullIdx > pageUnavailableIdx);
  assert.ok(applyStartIdx > pageFullIdx);
  assert.ok(applyOkIdx > applyStartIdx);
  assert.ok(syncClassesIdx > applyOkIdx, "SYNC classes immédiat, pas après les 5");
  assert.ok(startStudentsIdx > syncClassesIdx, "students démarre après outcome classes");
  assert.equal(lines.filter((line) => line.startsWith(RC2_L1_SYNC_EXCEPTION_TAG)).length, 0);
  assert.deepEqual(
    syncResults.map((row) => row.outcome),
    L1_RESOURCES.map(() => "ready"),
  );
  for (const resource of L1_RESOURCES) {
    assert.ok(lines.includes(`RC2_L1_SYNC_START resource=${resource}`));
    assert.ok(lines.includes(`RC2_L1_SYNC resource=${resource} outcome=ready`));
  }

  resetRc2OfflineReadSmokeForTests({
    logger: { warn: (message) => lines.push(message) },
  });
  lines.length = 0;
  const metaBoomStore = createMemoryL1Store();
  await metaBoomStore.migrate();
  metaBoomStore.getMeta = async () => {
    throw new Error("sqlite meta boom jwt userId=secret");
  };
  await assert.rejects(() =>
    syncL1Cache({
      store: metaBoomStore,
      api: sequentialApi,
      partition: partitionA,
      isCurrent: () => true,
    }),
  );
  assert.ok(lines.includes("RC2_L1_SYNC_START resource=classes"));
  assert.ok(lines.includes("RC2_L1_STAGE resource=classes stage=meta_start"));
  assert.ok(lines.includes("RC2_L1_SYNC_EXCEPTION resource=classes stage=meta reason=unexpected"));
  assert.equal(lines.includes("RC2_L1_STAGE resource=classes stage=meta_ok"), false);
  assert.equal(lines.filter((line) => line.startsWith(RC2_L1_PAGE_TAG)).length, 0);
  assert.equal(
    lines.filter((line) => /boom|jwt|userId=|secret/i.test(line)).length,
    0,
    "aucun message d'exception brut",
  );
  assert.equal(lines.filter((line) => line === "RC2_L1_SYNC_EXCEPTION resource=classes reason=unexpected").length, 0);

  resetRc2OfflineReadSmokeForTests({
    logger: { warn: (message) => lines.push(message) },
  });
  lines.length = 0;
  const reconcileBoomStore = createMemoryL1Store();
  await reconcileBoomStore.migrate();
  const originalExclusive = reconcileBoomStore.withExclusiveTransaction.bind(reconcileBoomStore);
  reconcileBoomStore.withExclusiveTransaction = async (fn) =>
    originalExclusive(async (txn) => {
      txn.putMeta = async () => {
        throw new Error("reconcile boom jwt scopeHash=secret");
      };
      return fn(txn);
    });
  await assert.rejects(() =>
    syncL1Cache({
      store: reconcileBoomStore,
      api: sequentialApi,
      partition: partitionA,
      isCurrent: () => true,
    }),
  );
  assert.ok(lines.includes("RC2_L1_STAGE resource=classes stage=meta_ok"));
  assert.ok(lines.includes("RC2_L1_STAGE resource=classes stage=reconcile_start"));
  assert.ok(lines.includes("RC2_L1_SYNC_EXCEPTION resource=classes stage=reconcile reason=unexpected"));
  assert.equal(lines.includes("RC2_L1_STAGE resource=classes stage=reconcile_ok"), false);
  assert.equal(lines.filter((line) => line.startsWith(RC2_L1_PAGE_TAG)).length, 0);
  assert.equal(lines.filter((line) => /boom|jwt|scopeHash=/i.test(line)).length, 0);

  resetRc2OfflineReadSmokeForTests({
    logger: { warn: (message) => lines.push(message) },
  });
  lines.length = 0;
  const classifiedStore = createMemoryL1Store();
  await classifiedStore.migrate();
  const classifiedApi: L1Api = {
    async fetchPage() {
      const error = new Error("timeout jwt") as Error & { code: string };
      error.code = "NETWORK_UNAVAILABLE";
      throw error;
    },
  };
  const classifiedResults = await syncL1Cache({
    store: classifiedStore,
    api: classifiedApi,
    partition: partitionA,
    isCurrent: () => true,
  });
  assert.equal(classifiedResults[0]?.outcome, "error");
  assert.equal(classifiedResults[0]?.code, "NETWORK_UNAVAILABLE");
  assert.ok(lines.includes("RC2_L1_STAGE resource=classes stage=fetch_start"));
  assert.ok(lines.includes("RC2_L1_SYNC resource=classes outcome=error code=NETWORK_UNAVAILABLE"));
  assert.equal(lines.filter((line) => line.startsWith(RC2_L1_SYNC_EXCEPTION_TAG)).length, 0);
  assert.equal(lines.filter((line) => line.startsWith(RC2_L1_PAGE_TAG)).length, 0);
  assert.equal(lines.filter((line) => /timeout jwt/i.test(line)).length, 0);

  const teacher = {
    role: "teacher",
    user: { id: "user-a", schoolId: "school-1" },
  };
  assert.equal(
    l1AssignmentBelongsToTeacherSession(
      { teacherUserId: null, teacherCode: "ENS-A", teacherId: "tch-a" },
      teacher,
    ),
    false,
  );
  assert.equal(
    l1AssignmentBelongsToTeacherSession(
      { teacherUserId: "user-other", teacherCode: "ENS-A", teacherId: "tch-a" },
      teacher,
    ),
    false,
  );
  assert.equal(
    filterL1AssignmentsForTeacherSession(
      [
        { id: "1", teacherUserId: "user-a", classId: "c1", subjectCode: "MATH", status: "active" } as never,
        { id: "2", teacherUserId: "user-b", teacherCode: "ENS-A", classId: "c1", subjectCode: "FR", status: "active" } as never,
      ],
      teacher,
    ).length,
    1,
  );

  assert.equal(
    metricLabelFromSnapshot({ status: "error", data: [] }, () => "0%", "0%"),
    METRIC_UNAVAILABLE_LABEL,
  );
  assert.equal(
    metricLabelFromSnapshot({ status: "offline", data: [] }, () => "0%", "0%"),
    METRIC_UNAVAILABLE_LABEL,
  );
  assert.equal(shouldBlockUnsupportedMutations({ source: "l1-cache" }), true);
  assert.equal(shouldBlockUnsupportedMutations({ permissionsBootstrap: "ready_offline" }), true);

  const screens = [
    "src/screens/ClassesScreen.tsx",
    "src/screens/StudentsScreen.tsx",
    "src/screens/TimetableScreen.tsx",
    "src/screens/SchoolPedagogicalStructureScreen.tsx",
    "src/screens/StudentDetailScreen.tsx",
  ];
  for (const rel of screens) {
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.doesNotMatch(source, /expo-sqlite/);
    assert.doesNotMatch(source, /from ["'].*offline\/l1\/database/);
    assert.doesNotMatch(source, /listRows\(/);
    assert.doesNotMatch(source, /readL1Resource/);
  }

  const studentsSrc = fs.readFileSync(path.join(ROOT, "src/screens/StudentsScreen.tsx"), "utf8");
  assert.match(studentsSrc, /metricLabelFromSnapshot\(presencesSnapshot/);
  assert.match(studentsSrc, /metricLabelFromSnapshot\(\s*studentFeesSnapshot/);
  assert.doesNotMatch(studentsSrc, /presenceStats\.rate\s*\?\? 0/);

  const timetableSrc = fs.readFileSync(path.join(ROOT, "src/screens/TimetableScreen.tsx"), "utf8");
  assert.match(timetableSrc, /l1ReadOnly/);
  assert.match(timetableSrc, /unverified:\s*true/);
  assert.match(timetableSrc, /confirmedEmpty:\s*false/);

  const runtimeSrc = fs.readFileSync(path.join(ROOT, "src/offline/l1/L1CacheRuntime.tsx"), "utf8");
  assert.match(runtimeSrc, /logRc2OfflineBoot/);
  assert.doesNotMatch(runtimeSrc, /logRc2L1SyncResults/);
  assert.match(runtimeSrc, /await syncL1Cache/);
  const syncEngineSrc = fs.readFileSync(path.join(ROOT, "src/offline/l1/syncEngine.ts"), "utf8");
  assert.match(syncEngineSrc, /logRc2L1SyncStart/);
  assert.match(syncEngineSrc, /logRc2L1Page/);
  assert.match(syncEngineSrc, /logRc2L1Stage/);
  assert.match(syncEngineSrc, /logRc2L1SyncException/);
  assert.match(syncEngineSrc, /stage: "meta_start"/);
  assert.match(syncEngineSrc, /stage: "reconcile_start"/);
  assert.match(syncEngineSrc, /stage: "fetch_start"/);
  assert.match(syncEngineSrc, /stage: "apply_start"/);
  assert.doesNotMatch(syncEngineSrc, /error\.message/);
  const readModelSrc = fs.readFileSync(path.join(ROOT, "src/offline/l1/readModel.ts"), "utf8");
  assert.match(readModelSrc, /logRc2L1ReadFromSnapshot/);
  assert.match(readModelSrc, /logRc2L1Refusal/);

  const markerSrc = fs.readFileSync(path.join(ROOT, "src/offline/l1/rc2OfflineReadSmoke.ts"), "utf8");
  assert.match(markerSrc, new RegExp(RC2_L1_READ_TAG));
  assert.match(markerSrc, new RegExp(RC2_L1_SYNC_TAG));
  assert.match(markerSrc, new RegExp(RC2_L1_SYNC_START_TAG));
  assert.match(markerSrc, new RegExp(RC2_L1_PAGE_TAG));
  assert.match(markerSrc, new RegExp(RC2_L1_STAGE_TAG));
  assert.match(markerSrc, new RegExp(RC2_L1_SYNC_EXCEPTION_TAG));
  assert.match(markerSrc, new RegExp(RC2_L1_REFUSAL_TAG));
  assert.match(markerSrc, new RegExp(RC2_OFFLINE_BOOT_TAG));
  assert.match(markerSrc, new RegExp(RC2_OFFLINE_READ_SMOKE_TAG));
  assert.match(markerSrc, /ALLOWED_EXCEPTION_STAGE/);
  assert.doesNotMatch(markerSrc, /accessToken|refreshToken|l1DbKey/);
  assert.doesNotMatch(markerSrc, /error\.message/);

  logRc2L1ReadFromSnapshot("assignments", snapshotFromL1Cache([{ id: "a" }, { id: "b" }], "2026-08-27"));
  logRc2L1ReadFromSnapshot("school-courses", snapshotFromSuccess([], { source: "network" }));

  setL1ReadDepsForTests(null);
  resetL1LifecycleForTests();
  resetRc2OfflineReadSmokeForTests();
  console.log("OK: rc2 offline read smoke markers");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
