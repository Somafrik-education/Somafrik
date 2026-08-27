/**
 * Lecteur L1 unique. Les écrans ne touchent jamais SQLite.
 * PostgreSQL reste l'autorité ; SQLite n'est qu'une projection locale jetable.
 */
import {
  snapshotFromFailure,
  snapshotFromL1Cache,
  snapshotFromSuccess,
  snapshotL1Unavailable,
  type ResourceSnapshot,
} from "../../lib/dataTruth";
import { openNativeL1Database } from "./database";
import { getRememberedL1Runtime, rememberL1Runtime, resolveL1Partition } from "./lifecycle";
import type { L1OpenResult, L1Partition, L1Resource, L1Store, L1SyncMeta, SqlValue } from "./types";

export type L1SessionLike = {
  user?: { id?: string; schoolId?: string; schoolCode?: string };
  school?: { id?: string; code?: string };
} | null;

export type L1ReadRefusal =
  | "empty"
  | "reconciling"
  | "blocked_authorization"
  | "metadata_absent"
  | "partition_mismatch"
  | "sqlcipher_unavailable"
  | "partition_unresolved";

export type L1ReadOk = {
  ok: true;
  partition: L1Partition;
  meta: L1SyncMeta;
  rows: Record<string, SqlValue>[];
};

export type L1ReadResult = L1ReadOk | { ok: false; reason: L1ReadRefusal };

export type L1ReadDeps = {
  openStore?: () => Promise<L1OpenResult>;
  remembered?: () => { store: L1Store; partition: L1Partition } | null;
};

let testDeps: L1ReadDeps | null = null;

export function setL1ReadDepsForTests(deps: L1ReadDeps | null): void {
  testDeps = deps;
}

export function isStrictNetworkUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status =
    "status" in error ? Number((error as { status?: number }).status) : Number.NaN;
  if (Number.isFinite(status) && status > 0) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return code === "NETWORK_UNAVAILABLE";
}

export function shouldSkipMetierGet(permissionsBootstrap?: string | null): boolean {
  return permissionsBootstrap === "ready_offline";
}

export function shouldBlockUnsupportedMutations(input: {
  source?: ResourceSnapshot<unknown>["source"];
  permissionsBootstrap?: string | null;
}): boolean {
  return input.source === "l1-cache" || input.permissionsBootstrap === "ready_offline";
}

export function l1ReadInteractionPolicy(input: {
  snapshot: Pick<ResourceSnapshot<unknown>, "status" | "source">;
  permissionsBootstrap?: string | null;
}): {
  searchEnabled: boolean;
  navigationEnabled: boolean;
  mutationsEnabled: boolean;
  readAvailable: boolean;
} {
  const readAvailable = input.snapshot.status === "success" || input.snapshot.status === "empty";
  const cacheRead = readAvailable && input.snapshot.source === "l1-cache";
  const offlineBootstrap = input.permissionsBootstrap === "ready_offline";
  return {
    searchEnabled: true,
    navigationEnabled: readAvailable,
    mutationsEnabled: !shouldBlockUnsupportedMutations({
      source: input.snapshot.source,
      permissionsBootstrap: input.permissionsBootstrap,
    }),
    readAvailable: readAvailable || cacheRead || offlineBootstrap,
  };
}

function samePartition(left: L1Partition, right: L1Partition): boolean {
  return left.userId === right.userId && left.schoolId === right.schoolId;
}

async function resolveStore(
  partition: L1Partition,
  deps?: L1ReadDeps,
): Promise<{ ok: true; store: L1Store } | { ok: false; reason: "sqlcipher_unavailable" }> {
  const openStore = deps?.openStore ?? testDeps?.openStore;
  if (!openStore) {
    const remembered = (deps?.remembered ?? testDeps?.remembered ?? getRememberedL1Runtime)();
    if (remembered && samePartition(remembered.partition, partition)) {
      return { ok: true, store: remembered.store };
    }
  }

  const opened = await (openStore ?? openNativeL1Database)();
  if (!opened.ok) {
    return { ok: false, reason: "sqlcipher_unavailable" };
  }
  void rememberL1Runtime(opened.store, partition);
  return { ok: true, store: opened.store };
}

/**
 * Lit une ressource L1 uniquement si meta.state === "ready" dans la partition
 * exacte userId+schoolId. ready + 0 rows = vide métier confirmé.
 */
export async function readL1Resource(input: {
  session: L1SessionLike;
  resource: L1Resource;
  deps?: L1ReadDeps;
}): Promise<L1ReadResult> {
  const resolved = resolveL1Partition(input.session);
  if (!resolved.ok) {
    return { ok: false, reason: "partition_unresolved" };
  }
  const { partition } = resolved;

  const storeResult = await resolveStore(partition, input.deps);
  if (!storeResult.ok) return storeResult;

  let meta: L1SyncMeta | null;
  try {
    meta = await storeResult.store.getMeta(partition, input.resource);
  } catch {
    return { ok: false, reason: "sqlcipher_unavailable" };
  }

  if (!meta) {
    return { ok: false, reason: "metadata_absent" };
  }
  if (meta.userId !== partition.userId || meta.schoolId !== partition.schoolId) {
    return { ok: false, reason: "partition_mismatch" };
  }
  if (meta.state === "empty" || meta.state === "reconciling" || meta.state === "blocked_authorization") {
    return { ok: false, reason: meta.state };
  }
  if (meta.state !== "ready") {
    return { ok: false, reason: "empty" };
  }

  const rows = await storeResult.store.listRows(input.resource, partition);
  return { ok: true, partition, meta, rows };
}

export function snapshotFromL1Read<T>(
  read: L1ReadResult,
  project: (read: L1ReadOk) => T[],
): ResourceSnapshot<T> {
  if (!read.ok) {
    return snapshotL1Unavailable();
  }
  return snapshotFromL1Cache(project(read), read.meta.lastSuccessAt);
}

export async function loadL1BackedSnapshot<T>(input: {
  session: L1SessionLike;
  permissionsBootstrap?: string | null;
  resource: L1Resource;
  fetchNetwork: () => Promise<T[]>;
  project: (read: L1ReadOk) => T[] | Promise<T[]>;
  deps?: L1ReadDeps;
}): Promise<ResourceSnapshot<T>> {
  const readAndProject = async (): Promise<ResourceSnapshot<T>> => {
    const read = await readL1Resource({
      session: input.session,
      resource: input.resource,
      deps: input.deps,
    });
    if (!read.ok) return snapshotL1Unavailable();
    return snapshotFromL1Cache(await input.project(read), read.meta.lastSuccessAt);
  };

  if (!input.session) {
    return snapshotL1Unavailable();
  }

  if (shouldSkipMetierGet(input.permissionsBootstrap)) {
    return readAndProject();
  }

  try {
    const rows = await input.fetchNetwork();
    return snapshotFromSuccess(rows, { source: "network" });
  } catch (error) {
    if (isStrictNetworkUnavailable(error)) {
      return readAndProject();
    }
    return snapshotFromFailure(error, []);
  }
}
