/**
 * Ouverture SQLCipher exclusive. Aucun fallback SQLite en clair.
 * La clé vit uniquement dans SecureStore (`somafrik.l1DbKeyV1`).
 */
import { L1_DB_FILENAME, L1_DB_KEY_SECURESTORE, L1_ERROR, type L1OpenResult, type L1Store } from "./types";
import { applyL1Migrations } from "./migrations";
import { L1_RESOURCE_COLUMNS, L1_TABLE_BY_RESOURCE } from "./schema";
import type { L1Partition, L1Resource, L1SyncMeta, SqlValue } from "./types";

export type L1KeyStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type L1SqliteLike = {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  withTransactionAsync<T>(fn: () => Promise<T>): Promise<T>;
  closeAsync(): Promise<void>;
};

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export async function generateL1DbKeyHex(getRandomBytes: (size: number) => Uint8Array | Promise<Uint8Array>): Promise<string> {
  const bytes = await getRandomBytes(32);
  return bytesToHex(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
}

export async function loadOrCreateL1DbKey(keyStore: L1KeyStore, generateKey: () => Promise<string>): Promise<string> {
  const existing = String((await keyStore.getItem(L1_DB_KEY_SECURESTORE)) ?? "").trim();
  if (existing) return existing;
  const created = await generateKey();
  await keyStore.setItem(L1_DB_KEY_SECURESTORE, created);
  return created;
}

function createSqliteStore(db: L1SqliteLike, cipherVersion: string): L1Store {
  async function exec(sql: string) {
    await db.execAsync(sql);
  }
  async function run(sql: string, params: unknown[] = []) {
    await db.runAsync(sql, params);
  }
  async function get<T>(sql: string, params: unknown[] = []) {
    return (await db.getFirstAsync<T>(sql, params)) ?? undefined;
  }
  async function all<T>(sql: string, params: unknown[] = []) {
    return db.getAllAsync<T>(sql, params);
  }

  return {
    kind: "sqlcipher",
    cipherVersion,
    async migrate() {
      await applyL1Migrations({ exec, get, run });
    },
    async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
      return db.withTransactionAsync(fn);
    },
    async upsertRow(resource, partition, row) {
      const table = L1_TABLE_BY_RESOURCE[resource];
      const columns = ["user_id", "school_id", "school_code", ...L1_RESOURCE_COLUMNS[resource]];
      const uniqueColumns = [...new Set(columns)];
      const values = uniqueColumns.map((column) => {
        if (column === "user_id") return partition.userId;
        if (column === "school_id") return partition.schoolId;
        if (column === "school_code") return partition.schoolCode;
        return row[column] ?? null;
      });
      const placeholders = uniqueColumns.map(() => "?").join(", ");
      const updates = uniqueColumns
        .filter((column) => column !== "user_id" && column !== "school_id" && column !== "id")
        .map((column) => `${column} = excluded.${column}`)
        .join(", ");
      await run(
        `INSERT INTO ${table} (${uniqueColumns.join(", ")})
         VALUES (${placeholders})
         ON CONFLICT(user_id, school_id, id) DO UPDATE SET ${updates}`,
        values,
      );
    },
    async deleteRow(resource, partition, id) {
      await run(
        `DELETE FROM ${L1_TABLE_BY_RESOURCE[resource]} WHERE user_id = ? AND school_id = ? AND id = ?`,
        [partition.userId, partition.schoolId, id],
      );
    },
    async purgeResource(partition, resource) {
      await run(`DELETE FROM ${L1_TABLE_BY_RESOURCE[resource]} WHERE user_id = ? AND school_id = ?`, [
        partition.userId,
        partition.schoolId,
      ]);
      await run(`DELETE FROM l1_sync_meta WHERE user_id = ? AND school_id = ? AND resource = ?`, [
        partition.userId,
        partition.schoolId,
        resource,
      ]);
    },
    async purgePartition(partition) {
      for (const resource of Object.keys(L1_TABLE_BY_RESOURCE) as L1Resource[]) {
        await this.purgeResource(partition, resource);
      }
    },
    async getRow(resource, partition, id) {
      return (
        (await get<Record<string, SqlValue>>(
          `SELECT * FROM ${L1_TABLE_BY_RESOURCE[resource]} WHERE user_id = ? AND school_id = ? AND id = ? LIMIT 1`,
          [partition.userId, partition.schoolId, id],
        )) ?? null
      );
    },
    async listRows(resource, partition) {
      return all<Record<string, SqlValue>>(
        `SELECT * FROM ${L1_TABLE_BY_RESOURCE[resource]} WHERE user_id = ? AND school_id = ?`,
        [partition.userId, partition.schoolId],
      );
    },
    async getMeta(partition, resource) {
      const row = await get<{
        user_id: string;
        school_id: string;
        school_code: string | null;
        resource: L1Resource;
        cursor: string | null;
        scope_hash: string | null;
        state: L1SyncMeta["state"];
        schema_version: number;
        last_success_at: string | null;
      }>(
        `SELECT user_id, school_id, school_code, resource, cursor, scope_hash, state, schema_version, last_success_at
         FROM l1_sync_meta WHERE user_id = ? AND school_id = ? AND resource = ? LIMIT 1`,
        [partition.userId, partition.schoolId, resource],
      );
      if (!row) return null;
      return {
        userId: row.user_id,
        schoolId: row.school_id,
        schoolCode: row.school_code ?? partition.schoolCode,
        resource: row.resource,
        cursor: row.cursor,
        scopeHash: row.scope_hash,
        state: row.state,
        schemaVersion: Number(row.schema_version),
        lastSuccessAt: row.last_success_at,
      };
    },
    async putMeta(meta) {
      await run(
        `INSERT INTO l1_sync_meta (
           user_id, school_id, school_code, resource, cursor, scope_hash, state, schema_version, last_success_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, school_id, resource) DO UPDATE SET
           school_code = excluded.school_code,
           cursor = excluded.cursor,
           scope_hash = excluded.scope_hash,
           state = excluded.state,
           schema_version = excluded.schema_version,
           last_success_at = excluded.last_success_at`,
        [
          meta.userId,
          meta.schoolId,
          meta.schoolCode,
          meta.resource,
          meta.cursor,
          meta.scopeHash,
          meta.state,
          meta.schemaVersion,
          meta.lastSuccessAt,
        ],
      );
    },
    async close() {
      await db.closeAsync();
    },
  };
}

export async function openEncryptedL1Database(deps: {
  platform: string;
  openDatabase: (name: string) => Promise<L1SqliteLike>;
  keyStore: L1KeyStore;
  generateKey: () => Promise<string>;
}): Promise<L1OpenResult> {
  if (deps.platform === "web") {
    return {
      ok: false,
      code: L1_ERROR.SQLCIPHER_REQUIRED,
      message: "SQLCipher n'est pas disponible sur Web. Aucun cache L1 plaintext n'est créé.",
    };
  }

  const key = await loadOrCreateL1DbKey(deps.keyStore, deps.generateKey);
  const db = await deps.openDatabase(L1_DB_FILENAME);
  await db.execAsync(`PRAGMA key = '${escapeSqlLiteral(key)}'`);
  const pragma = await db.getFirstAsync<{ cipher_version?: string }>("PRAGMA cipher_version");
  const cipherVersion = String(pragma?.cipher_version ?? "").trim();
  if (!cipherVersion) {
    await db.closeAsync().catch(() => undefined);
    return {
      ok: false,
      code: L1_ERROR.SQLCIPHER_REQUIRED,
      message: "SQLCipher absent. Aucun cache métier plaintext n'est créé.",
    };
  }

  const store = createSqliteStore(db, cipherVersion);
  await store.migrate();
  return { ok: true, store };
}

let nativeOpenPromise: Promise<L1OpenResult> | null = null;

async function openNativeL1DatabaseUncached(): Promise<L1OpenResult> {
  let platform = "unknown";
  try {
    const ReactNative = require("react-native") as { Platform?: { OS?: string } };
    platform = String(ReactNative.Platform?.OS ?? "unknown");
  } catch {
    platform = "node";
  }
  if (platform === "web" || platform === "node") {
    return {
      ok: false,
      code: L1_ERROR.SQLCIPHER_REQUIRED,
      message: `SQLCipher natif requis (platform=${platform}).`,
    };
  }

  const SQLite = require("expo-sqlite") as {
    openDatabaseAsync: (name: string) => Promise<L1SqliteLike>;
  };
  const SecureStore = require("expo-secure-store") as {
    getItemAsync: (key: string) => Promise<string | null>;
    setItemAsync: (
      key: string,
      value: string,
      options?: { keychainAccessible?: number },
    ) => Promise<void>;
    WHEN_UNLOCKED_THIS_DEVICE_ONLY?: number;
  };
  const Crypto = require("expo-crypto") as {
    getRandomBytesAsync: (size: number) => Promise<Uint8Array>;
  };

  return openEncryptedL1Database({
    platform,
    openDatabase: (name) => SQLite.openDatabaseAsync(name),
    keyStore: {
      async getItem(key) {
        return SecureStore.getItemAsync(key);
      },
      async setItem(key, value) {
        await SecureStore.setItemAsync(key, value, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      },
    },
    generateKey: () => generateL1DbKeyHex((size) => Crypto.getRandomBytesAsync(size)),
  });
}

export async function openNativeL1Database(): Promise<L1OpenResult> {
  if (!nativeOpenPromise) {
    nativeOpenPromise = openNativeL1DatabaseUncached();
  }
  return nativeOpenPromise;
}
