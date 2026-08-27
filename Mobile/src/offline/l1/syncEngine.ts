import { applyL1PageAtomically, isL1StaleTransaction, markResourceState, purgeResourceAndReset } from "./repository";
import { L1PayloadError } from "./syncApi";
import {
  logRc2L1Page,
  logRc2L1Stage,
  logRc2L1Sync,
  logRc2L1SyncException,
  logRc2L1SyncStart,
} from "./rc2OfflineReadSmoke";
import {
  L1_ERROR,
  L1_LOCAL_SCHEMA_VERSION,
  L1_RESOURCES,
  type L1Api,
  type L1Partition,
  type L1Resource,
  type L1Store,
  type L1SyncMeta,
} from "./types";

export const L1_MAX_PAGES = 500;

export type L1SyncResult = {
  resource: L1Resource;
  outcome:
    | "ready"
    | "blocked_authorization"
    | "discarded"
    | "network_preserved"
    | "error";
  code?: string;
};

type Rc2ExceptionStage = "meta" | "reconcile" | "fetch" | "apply";

const stagedUnexpected = new WeakSet<object>();

function rethrowUnexpected(resource: L1Resource, stage: Rc2ExceptionStage, error: unknown): never {
  logRc2L1SyncException({ resource, reason: "unexpected", stage });
  if (error && typeof error === "object") {
    stagedUnexpected.add(error);
  }
  throw error;
}

function isStagedUnexpected(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && stagedUnexpected.has(error));
}

function emptyMeta(partition: L1Partition, resource: L1Resource): L1SyncMeta {
  return {
    userId: partition.userId,
    schoolId: partition.schoolId,
    schoolCode: partition.schoolCode,
    resource,
    cursor: null,
    scopeHash: null,
    state: "empty",
    schemaVersion: L1_LOCAL_SCHEMA_VERSION,
    lastSuccessAt: null,
  };
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = Number((error as { status?: number }).status);
  return Number.isFinite(status) ? status : undefined;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  return String((error as { code?: string }).code ?? "");
}

async function loadMeta(
  store: L1Store,
  partition: L1Partition,
  resource: L1Resource,
  fallback: L1SyncMeta,
): Promise<L1SyncMeta> {
  logRc2L1Stage({ resource, stage: "meta_start" });
  try {
    const meta = (await store.getMeta(partition, resource)) ?? fallback;
    logRc2L1Stage({ resource, stage: "meta_ok" });
    return meta;
  } catch (error) {
    rethrowUnexpected(resource, "meta", error);
  }
}

async function beginFullReconcile(
  store: L1Store,
  partition: L1Partition,
  resource: L1Resource,
  isCurrent: () => boolean,
): Promise<"ok" | "discarded"> {
  logRc2L1Stage({ resource, stage: "reconcile_start" });
  try {
    await purgeResourceAndReset(store, partition, resource, "reconciling", isCurrent);
  } catch (error) {
    if (isL1StaleTransaction(error) || !isCurrent()) return "discarded";
    rethrowUnexpected(resource, "reconcile", error);
  }
  logRc2L1Stage({ resource, stage: "reconcile_ok" });
  return isCurrent() ? "ok" : "discarded";
}

async function syncOneResource(args: {
  store: L1Store;
  api: L1Api;
  partition: L1Partition;
  resource: L1Resource;
  isCurrent: () => boolean;
}): Promise<L1SyncResult> {
  const { store, api, partition, resource, isCurrent } = args;
  if (!isCurrent()) return { resource, outcome: "discarded" };

  let meta = await loadMeta(store, partition, resource, emptyMeta(partition, resource));
  let localFull = meta.state !== "ready" || !meta.cursor;
  let storedCursor = localFull && meta.state !== "reconciling" ? null : meta.cursor;
  let invalidReconcileUsed = false;
  let protocolReconcileUsed = false;

  if (localFull && (meta.state === "empty" || !meta.cursor)) {
    logRc2L1Stage({ resource, stage: "reconcile_start" });
    try {
      await markResourceState(store, partition, resource, {
        state: "reconciling",
        cursor: null,
      }, isCurrent);
    } catch (error) {
      if (isL1StaleTransaction(error) || !isCurrent()) return { resource, outcome: "discarded" };
      rethrowUnexpected(resource, "reconcile", error);
    }
    logRc2L1Stage({ resource, stage: "reconcile_ok" });
    storedCursor = null;
  }

  let pages = 0;
  while (pages < L1_MAX_PAGES) {
    if (!isCurrent()) return { resource, outcome: "discarded" };
    pages += 1;
    let page;
    logRc2L1Stage({ resource, stage: "fetch_start" });
    try {
      page = await api.fetchPage(resource, storedCursor);
    } catch (error) {
      if (!isCurrent()) return { resource, outcome: "discarded" };
      const status = errorStatus(error);
      const code = errorCode(error);

      if (status === 401) {
        try {
          if (isCurrent()) await store.purgePartition(partition);
        } catch (purgeError) {
          rethrowUnexpected(resource, "fetch", purgeError);
        }
        return { resource, outcome: "error", code: "UNAUTHORIZED" };
      }
      if (status === 403) {
        try {
          await purgeResourceAndReset(store, partition, resource, "blocked_authorization", isCurrent);
        } catch (error) {
          if (isL1StaleTransaction(error) || !isCurrent()) return { resource, outcome: "discarded" };
          rethrowUnexpected(resource, "reconcile", error);
        }
        if (!isCurrent()) return { resource, outcome: "discarded" };
        return { resource, outcome: "blocked_authorization", code };
      }
      if (code === "MOBILE_SYNC_SCOPE_CHANGED" || code === "MOBILE_SYNC_CURSOR_EXPIRED") {
        if (!isCurrent()) return { resource, outcome: "discarded" };
        if (protocolReconcileUsed) {
          return { resource, outcome: "error", code };
        }
        protocolReconcileUsed = true;
        if ((await beginFullReconcile(store, partition, resource, isCurrent)) === "discarded") {
          return { resource, outcome: "discarded" };
        }
        storedCursor = null;
        localFull = true;
        invalidReconcileUsed = false;
        meta = await loadMeta(store, partition, resource, emptyMeta(partition, resource));
        continue;
      }
      if (code === "MOBILE_SYNC_CURSOR_INVALID") {
        if (!storedCursor || invalidReconcileUsed) {
          return { resource, outcome: "error", code: L1_ERROR.CURSOR_INVALID_LOOP };
        }
        invalidReconcileUsed = true;
        if ((await beginFullReconcile(store, partition, resource, isCurrent)) === "discarded") {
          return { resource, outcome: "discarded" };
        }
        storedCursor = null;
        localFull = true;
        continue;
      }
      if (code === "NETWORK_UNAVAILABLE") {
        if (meta.state === "ready") {
          return { resource, outcome: "network_preserved" };
        }
        return { resource, outcome: "error", code };
      }
      if (status != null && status >= 500) {
        return { resource, outcome: "error", code: code || "BACKEND_5XX" };
      }
      return { resource, outcome: "error", code: code || "SYNC_ERROR" };
    }

    if (!isCurrent()) return { resource, outcome: "discarded" };

    logRc2L1Page({
      resource,
      mode: page.mode,
      hasMore: page.hasMore,
      page: pages,
    });

    if (page.mode === "full_required" || page.mode === "unavailable") {
      if ((await beginFullReconcile(store, partition, resource, isCurrent)) === "discarded") {
        return { resource, outcome: "discarded" };
      }
      storedCursor = null;
      localFull = true;
      continue;
    }

    if (storedCursor && meta.scopeHash && page.scopeHash !== meta.scopeHash) {
      if (protocolReconcileUsed) {
        return { resource, outcome: "error", code: "L1_SCOPE_HASH_MISMATCH" };
      }
      protocolReconcileUsed = true;
      if ((await beginFullReconcile(store, partition, resource, isCurrent)) === "discarded") {
        return { resource, outcome: "discarded" };
      }
      storedCursor = null;
      localFull = true;
      meta = await loadMeta(store, partition, resource, emptyMeta(partition, resource));
      continue;
    }

    const nextState = localFull && page.hasMore ? "reconciling" : "ready";
    logRc2L1Stage({ resource, stage: "apply_start" });
    try {
      await applyL1PageAtomically(store, partition, resource, page, nextState, isCurrent);
    } catch (error) {
      if (isL1StaleTransaction(error) || !isCurrent()) return { resource, outcome: "discarded" };
      rethrowUnexpected(resource, "apply", error);
    }
    logRc2L1Stage({ resource, stage: "apply_ok" });
    if (!isCurrent()) {
      return { resource, outcome: "discarded" };
    }
    meta = await loadMeta(store, partition, resource, meta);
    if (!page.hasMore) {
      return { resource, outcome: "ready" };
    }
    storedCursor = page.nextCursor;
  }

  return { resource, outcome: "error", code: "L1_PAGE_LIMIT" };
}

export async function syncL1Cache(args: {
  store: L1Store;
  api: L1Api;
  partition: L1Partition;
  isCurrent: () => boolean;
}): Promise<L1SyncResult[]> {
  const results: L1SyncResult[] = [];
  for (const resource of L1_RESOURCES) {
    logRc2L1SyncStart({ resource });
    if (!args.isCurrent()) {
      const discarded: L1SyncResult = { resource, outcome: "discarded" };
      logRc2L1Sync(discarded);
      results.push(discarded);
      continue;
    }
    try {
      const result = await syncOneResource({
        store: args.store,
        api: args.api,
        partition: args.partition,
        resource,
        isCurrent: args.isCurrent,
      });
      logRc2L1Sync(result);
      results.push(result);
    } catch (error) {
      if (!isStagedUnexpected(error)) {
        logRc2L1SyncException({ resource, reason: "unexpected" });
      }
      throw error;
    }
  }
  return results;
}

export { L1PayloadError };
