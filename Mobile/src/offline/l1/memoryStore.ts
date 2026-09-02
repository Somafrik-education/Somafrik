import { applyL1Migrations } from "./migrations";
import { L1_RESOURCE_COLUMNS, L1_TABLE_BY_RESOURCE } from "./schema";
import {
  L1_ERROR,
  L1_RESOURCES,
  type L1Partition,
  type L1Resource,
  type L1Store,
  type L1SyncMeta,
  type L1Txn,
  type SqlValue,
} from "./types";

type TableRow = Record<string, SqlValue>;

export type MemoryL1Bucket = {
  tables: Record<string, Map<string, TableRow>>;
  metas: Map<string, L1SyncMeta>;
  migrations: Map<number, string>;
};

export function createMemoryL1Bucket(): MemoryL1Bucket {
  const tables: Record<string, Map<string, TableRow>> = {};
  for (const resource of L1_RESOURCES) {
    tables[L1_TABLE_BY_RESOURCE[resource]] = new Map();
  }
  return {
    tables,
    metas: new Map(),
    migrations: new Map(),
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function partitionKey(partition: L1Partition): string {
  return `${partition.userId}\0${partition.schoolId}`;
}

function rowKey(partition: L1Partition, id: string): string {
  return `${partitionKey(partition)}\0${id}`;
}

function metaKey(partition: L1Partition, resource: L1Resource): string {
  return `${partitionKey(partition)}\0${resource}`;
}

function enqueueWrite<T>(tail: { current: Promise<void> }, fn: () => Promise<T>): Promise<T> {
  const run = tail.current.then(fn, fn);
  tail.current = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Adapter injectable pour la CI Node. Simule SQLCipher et une transaction
 * exclusive (purge logout hors snapshot de sync). Jamais un fallback plaintext natif.
 */
export function createMemoryL1Store(options?: {
  cipherVersion?: string;
  cipherKey?: string;
  openKey?: string;
  bucket?: MemoryL1Bucket;
}): L1Store {
  const expectedKey = options?.cipherKey ?? "memory-test-key";
  const openKey = options?.openKey ?? expectedKey;
  if (openKey !== expectedKey) {
    const error = new Error(L1_ERROR.UNLOCK_FAILED);
    (error as Error & { code: string }).code = L1_ERROR.UNLOCK_FAILED;
    throw error;
  }
  const cipherVersion = options?.cipherVersion ?? "4.5.0 community";
  if (!cipherVersion) {
    const error = new Error(L1_ERROR.SQLCIPHER_REQUIRED);
    (error as Error & { code: string }).code = L1_ERROR.SQLCIPHER_REQUIRED;
    throw error;
  }

  const bucket = options?.bucket ?? createMemoryL1Bucket();
  const tables = bucket.tables;
  const metas = bucket.metas;
  const migrations = bucket.migrations;
  const writeTail = { current: Promise.resolve() };

  function takeSnapshot() {
    const nextTables: Record<string, Map<string, TableRow>> = {};
    for (const [name, rows] of Object.entries(tables)) {
      nextTables[name] = new Map(
        [...rows.entries()].map(([key, row]) => [key, clone(row)]),
      );
    }
    return {
      tables: nextTables,
      metas: new Map([...metas.entries()].map(([key, value]) => [key, clone(value)])),
      migrations: new Map(migrations),
    };
  }

  function restoreSnapshot(saved: ReturnType<typeof takeSnapshot>) {
    for (const name of Object.keys(tables)) {
      tables[name].clear();
      for (const [key, row] of saved.tables[name] ?? []) {
        tables[name].set(key, clone(row));
      }
    }
    metas.clear();
    for (const [key, value] of saved.metas) metas.set(key, clone(value));
    migrations.clear();
    for (const [key, value] of saved.migrations) migrations.set(key, value);
  }

  const executor = {
    async exec(sql: string) {
      if (/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(sql)) {
        return;
      }
    },
    async get(sql: string) {
      if (/FROM schema_migrations/i.test(sql)) {
        const versions = [...migrations.keys()].sort((a, b) => b - a);
        if (!versions.length) return undefined;
        return { version: versions[0] };
      }
      return undefined;
    },
    async run(sql: string, params: unknown[] = []) {
      if (/INSERT OR REPLACE INTO schema_migrations/i.test(sql)) {
        migrations.set(Number(params[0]), String(params[1] ?? ""));
      }
    },
  };

  const txn: L1Txn = {
    async upsertRow(resource, partition, row) {
      const table = L1_TABLE_BY_RESOURCE[resource];
      const id = String(row.id ?? "");
      const stored: TableRow = {
        user_id: partition.userId,
        school_id: partition.schoolId,
        school_code: partition.schoolCode,
      };
      for (const column of L1_RESOURCE_COLUMNS[resource]) {
        stored[column] = row[column] ?? null;
      }
      stored.id = id;
      tables[table].set(rowKey(partition, id), stored);
    },
    async deleteRow(resource, partition, id) {
      tables[L1_TABLE_BY_RESOURCE[resource]].delete(rowKey(partition, id));
    },
    async purgeResource(partition, resource) {
      const table = tables[L1_TABLE_BY_RESOURCE[resource]];
      const prefix = `${partitionKey(partition)}\0`;
      for (const key of [...table.keys()]) {
        if (key.startsWith(prefix)) table.delete(key);
      }
      metas.delete(metaKey(partition, resource));
    },
    async purgePartition(partition) {
      for (const resource of L1_RESOURCES) {
        await txn.purgeResource(partition, resource);
      }
    },
    async getRow(resource, partition, id) {
      return tables[L1_TABLE_BY_RESOURCE[resource]].get(rowKey(partition, id)) ?? null;
    },
    async listRows(resource, partition) {
      return [...tables[L1_TABLE_BY_RESOURCE[resource]].values()].filter(
        (row) => row.user_id === partition.userId && row.school_id === partition.schoolId,
      );
    },
    async getMeta(partition, resource) {
      return metas.get(metaKey(partition, resource)) ?? null;
    },
    async putMeta(meta) {
      metas.set(metaKey(meta, meta.resource), clone(meta));
    },
  };

  const store: L1Store = {
    kind: "memory",
    cipherVersion,
    async migrate() {
      await applyL1Migrations(executor);
    },
    async withExclusiveTransaction<T>(fn: (scoped: L1Txn) => Promise<T>): Promise<T> {
      return enqueueWrite(writeTail, async () => {
        const snapshot = takeSnapshot();
        try {
          return await fn(txn);
        } catch (error) {
          restoreSnapshot(snapshot);
          throw error;
        }
      });
    },
    upsertRow: (resource, partition, row) => enqueueWrite(writeTail, () => txn.upsertRow(resource, partition, row)),
    deleteRow: (resource, partition, id) => enqueueWrite(writeTail, () => txn.deleteRow(resource, partition, id)),
    purgeResource: (partition, resource) => enqueueWrite(writeTail, () => txn.purgeResource(partition, resource)),
    purgePartition: (partition) => enqueueWrite(writeTail, () => txn.purgePartition(partition)),
    putMeta: (meta) => enqueueWrite(writeTail, () => txn.putMeta(meta)),
    getRow: (resource, partition, id) => txn.getRow(resource, partition, id),
    listRows: (resource, partition) => txn.listRows(resource, partition),
    getMeta: (partition, resource) => txn.getMeta(partition, resource),
    async close() {
      return;
    },
  };

  return store;
}
