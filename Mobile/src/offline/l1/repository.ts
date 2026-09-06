import { L1_DTO_TO_COLUMN, L1_RESOURCE_COLUMNS } from "./schema";
import {
  L1_LOCAL_SCHEMA_VERSION,
  type L1Item,
  type L1Page,
  type L1Partition,
  type L1Resource,
  type L1Store,
  type L1SyncState,
  type SqlValue,
} from "./types";

export const L1_TX_STALE = "L1_TX_STALE";

function asSqlValue(value: unknown): SqlValue {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return String(value);
}

export function mapItemToRow(resource: L1Resource, item: L1Item): Record<string, SqlValue> {
  const allowed = new Set(L1_RESOURCE_COLUMNS[resource]);
  const row: Record<string, SqlValue> = { id: String(item.id) };
  for (const [dtoKey, column] of Object.entries(L1_DTO_TO_COLUMN)) {
    if (!allowed.has(column)) continue;
    if (!(dtoKey in item)) continue;
    row[column] = asSqlValue(item[dtoKey]);
  }
  return row;
}

export async function replaceResourceSnapshotAtomically(
  store: L1Store,
  partition: L1Partition,
  resource: L1Resource,
  page: Pick<L1Page, "items" | "nextCursor" | "scopeHash">,
  state: L1SyncState,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  await store.withExclusiveTransaction(async (txn) => {
    if (!isCurrent()) return;
    await txn.purgeResource(partition, resource);
    for (const item of page.items) {
      const id = String(item.id ?? "").trim();
      if (!id || item.tombstone === true) continue;
      await txn.upsertRow(resource, partition, mapItemToRow(resource, item));
    }
    await txn.putMeta({
      userId: partition.userId,
      schoolId: partition.schoolId,
      schoolCode: partition.schoolCode,
      resource,
      cursor: page.nextCursor || null,
      scopeHash: page.scopeHash,
      state,
      schemaVersion: L1_LOCAL_SCHEMA_VERSION,
      lastSuccessAt: new Date().toISOString(),
    });
    if (!isCurrent()) {
      const error = new Error(L1_TX_STALE) as Error & { code: string };
      error.code = L1_TX_STALE;
      throw error;
    }
  });
}

export async function applyL1PageAtomically(
  store: L1Store,
  partition: L1Partition,
  resource: L1Resource,
  page: L1Page,
  state: L1SyncState,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  await store.withExclusiveTransaction(async (txn) => {
    if (!isCurrent()) return;
    for (const item of page.items) {
      const id = String(item.id ?? "").trim();
      if (!id) continue;
      if (item.tombstone === true) {
        await txn.deleteRow(resource, partition, id);
        continue;
      }
      await txn.upsertRow(resource, partition, mapItemToRow(resource, item));
    }
    await txn.putMeta({
      userId: partition.userId,
      schoolId: partition.schoolId,
      schoolCode: partition.schoolCode,
      resource,
      cursor: page.nextCursor || null,
      scopeHash: page.scopeHash,
      state,
      schemaVersion: L1_LOCAL_SCHEMA_VERSION,
      lastSuccessAt: new Date().toISOString(),
    });
    if (!isCurrent()) {
      const error = new Error(L1_TX_STALE) as Error & { code: string };
      error.code = L1_TX_STALE;
      throw error;
    }
  });
}

export async function markResourceState(
  store: L1Store,
  partition: L1Partition,
  resource: L1Resource,
  patch: Partial<{
    state: L1SyncState;
    cursor: string | null;
    scopeHash: string | null;
    lastSuccessAt: string | null;
  }>,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!isCurrent()) return;
  const current = await store.getMeta(partition, resource);
  if (!isCurrent()) return;
  await store.withExclusiveTransaction(async (txn) => {
    if (!isCurrent()) return;
    await txn.putMeta({
      userId: partition.userId,
      schoolId: partition.schoolId,
      schoolCode: partition.schoolCode,
      resource,
      cursor: patch.cursor !== undefined ? patch.cursor : (current?.cursor ?? null),
      scopeHash: patch.scopeHash !== undefined ? patch.scopeHash : (current?.scopeHash ?? null),
      state: patch.state ?? current?.state ?? "empty",
      schemaVersion: L1_LOCAL_SCHEMA_VERSION,
      lastSuccessAt: patch.lastSuccessAt !== undefined ? patch.lastSuccessAt : (current?.lastSuccessAt ?? null),
    });
    if (!isCurrent()) {
      const error = new Error(L1_TX_STALE) as Error & { code: string };
      error.code = L1_TX_STALE;
      throw error;
    }
  });
}

export async function purgeResourceAndReset(
  store: L1Store,
  partition: L1Partition,
  resource: L1Resource,
  state: L1SyncState,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!isCurrent()) return;
  await store.withExclusiveTransaction(async (txn) => {
    if (!isCurrent()) return;
    await txn.purgeResource(partition, resource);
    await txn.putMeta({
      userId: partition.userId,
      schoolId: partition.schoolId,
      schoolCode: partition.schoolCode,
      resource,
      cursor: null,
      scopeHash: null,
      state,
      schemaVersion: L1_LOCAL_SCHEMA_VERSION,
      lastSuccessAt: null,
    });
    if (!isCurrent()) {
      const error = new Error(L1_TX_STALE) as Error & { code: string };
      error.code = L1_TX_STALE;
      throw error;
    }
  });
}

export function isL1StaleTransaction(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === L1_TX_STALE);
}
