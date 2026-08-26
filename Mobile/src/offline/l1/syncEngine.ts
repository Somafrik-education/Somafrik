import { applyL1PageAtomically, markResourceState, purgeResourceAndReset } from "./repository";
import { L1PayloadError } from "./syncApi";
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

async function beginFullReconcile(store: L1Store, partition: L1Partition, resource: L1Resource): Promise<void> {
  await purgeResourceAndReset(store, partition, resource, "reconciling");
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

  let meta = (await store.getMeta(partition, resource)) ?? emptyMeta(partition, resource);
  let localFull = meta.state !== "ready" || !meta.cursor;
  let storedCursor = localFull && meta.state !== "reconciling" ? null : meta.cursor;
  let invalidReconcileUsed = false;
  let protocolReconcileUsed = false;

  if (localFull && (meta.state === "empty" || !meta.cursor)) {
    await markResourceState(store, partition, resource, {
      state: "reconciling",
      cursor: null,
    });
    storedCursor = null;
  }

  let pages = 0;
  while (pages < L1_MAX_PAGES) {
    if (!isCurrent()) return { resource, outcome: "discarded" };
    pages += 1;
    let page;
    try {
      page = await api.fetchPage(resource, storedCursor);
    } catch (error) {
      if (!isCurrent()) return { resource, outcome: "discarded" };
      const status = errorStatus(error);
      const code = errorCode(error);

      if (status === 401) {
        await store.purgePartition(partition);
        return { resource, outcome: "error", code: "UNAUTHORIZED" };
      }
      if (status === 403) {
        await purgeResourceAndReset(store, partition, resource, "blocked_authorization");
        return { resource, outcome: "blocked_authorization", code };
      }
      if (code === "MOBILE_SYNC_SCOPE_CHANGED" || code === "MOBILE_SYNC_CURSOR_EXPIRED") {
        if (!isCurrent()) return { resource, outcome: "discarded" };
        if (protocolReconcileUsed) {
          return { resource, outcome: "error", code };
        }
        protocolReconcileUsed = true;
        await beginFullReconcile(store, partition, resource);
        storedCursor = null;
        localFull = true;
        invalidReconcileUsed = false;
        meta = (await store.getMeta(partition, resource)) ?? emptyMeta(partition, resource);
        continue;
      }
      if (code === "MOBILE_SYNC_CURSOR_INVALID") {
        if (!storedCursor || invalidReconcileUsed) {
          return { resource, outcome: "error", code: L1_ERROR.CURSOR_INVALID_LOOP };
        }
        invalidReconcileUsed = true;
        await beginFullReconcile(store, partition, resource);
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

    if (page.mode === "full_required" || page.mode === "unavailable") {
      await beginFullReconcile(store, partition, resource);
      storedCursor = null;
      localFull = true;
      continue;
    }

    if (storedCursor && meta.scopeHash && page.scopeHash !== meta.scopeHash) {
      if (protocolReconcileUsed) {
        return { resource, outcome: "error", code: "L1_SCOPE_HASH_MISMATCH" };
      }
      protocolReconcileUsed = true;
      await beginFullReconcile(store, partition, resource);
      storedCursor = null;
      localFull = true;
      meta = (await store.getMeta(partition, resource)) ?? emptyMeta(partition, resource);
      continue;
    }

    const nextState = localFull && page.hasMore ? "reconciling" : "ready";
    await applyL1PageAtomically(store, partition, resource, page, nextState);
    if (!isCurrent()) {
      await store.purgePartition(partition);
      return { resource, outcome: "discarded" };
    }
    meta = (await store.getMeta(partition, resource)) ?? meta;
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
    if (!args.isCurrent()) {
      results.push({ resource, outcome: "discarded" });
      continue;
    }
    results.push(
      await syncOneResource({
        store: args.store,
        api: args.api,
        partition: args.partition,
        resource,
        isCurrent: args.isCurrent,
      }),
    );
  }
  return results;
}

export { L1PayloadError };
