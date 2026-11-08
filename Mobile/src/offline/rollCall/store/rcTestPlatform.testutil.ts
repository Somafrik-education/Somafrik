/**
 * NFC-PRES-LOCAL-PR2 — plateforme de TEST (Node uniquement, jamais importée par l'application).
 *
 * Moteur réel : `node:sqlite` (SQLite embarqué de Node 22) sur de vrais fichiers. Les contraintes,
 * triggers, transactions, journaux de restauration, `SQLITE_FULL` et la corruption sont donc ceux de
 * SQLite, pas une simulation.
 *
 * Seul SQLCipher est SIMULÉ (Node ne l'embarque pas) : la clé appliquée à la création est conservée
 * dans un fichier compagnon `.simkey` ; une ouverture avec une autre clé échoue comme SQLCipher
 * (« file is not a database ») ; `PRAGMA cipher_version` renvoie la valeur configurée ('' = absent).
 * Le chiffrement effectif sur disque est prouvé sur Android (scripts/run-rc-offline-native-smoke.js).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { L1SqliteLike } from "../../l1/database";
import type { RcKeyStore, RcPlatformDeps } from "./database";

export type TestPlatformOptions = {
  dir: string;
  cipherVersion?: string;
  /** Simule un moteur sans chiffrement : l'en-tête lu est celui du fichier SQLite en clair. */
  plaintextHeader?: boolean;
  keyStoreFile?: string;
  now?: { ms: number };
  sqlLog?: string[];
};

function sidecar(file: string) {
  return `${file}.simkey`;
}

export function createFileKeyStore(file: string): RcKeyStore & { dump(): Record<string, string> } {
  const read = (): Record<string, string> => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
  const write = (data: Record<string, string>) => fs.writeFileSync(file, JSON.stringify(data));
  return {
    async getItem(key) {
      return read()[key] ?? null;
    },
    async setItem(key, value) {
      const data = read();
      data[key] = value;
      write(data);
    },
    async deleteItem(key) {
      const data = read();
      delete data[key];
      write(data);
    },
    dump: read,
  };
}

function openNodeConnection(file: string, options: TestPlatformOptions): L1SqliteLike {
  const db = new DatabaseSync(file);
  let pendingKey: string | null = null;
  let unlocked = false;
  const ensureUnlocked = () => {
    if (unlocked) return;
    const stored = fs.existsSync(sidecar(file)) ? fs.readFileSync(sidecar(file), "utf8") : null;
    const isNew = !fs.existsSync(file) || fs.statSync(file).size === 0;
    if (stored == null && isNew && pendingKey != null) {
      fs.writeFileSync(sidecar(file), pendingKey);
    } else if (stored == null || stored !== pendingKey) {
      throw new Error("SQLITE_NOTADB: file is not a database");
    }
    unlocked = true;
  };
  const log = (sql: string) => options.sqlLog?.push(sql);
  const params = (values: unknown[] = []) => values.map((value) => (value === undefined ? null : value)) as never[];
  return {
    async execAsync(sql) {
      const key = /^\s*PRAGMA key = '((?:[^']|'')*)'\s*$/.exec(sql);
      if (key) {
        pendingKey = key[1].replace(/''/g, "'");
        log("PRAGMA key = '<redacted>'");
        return;
      }
      log(sql);
      ensureUnlocked();
      db.exec(sql);
    },
    async runAsync(sql, values) {
      log(sql);
      ensureUnlocked();
      const result = db.prepare(sql).run(...params(values));
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async getFirstAsync<T>(sql: string, values?: unknown[]) {
      log(sql);
      if (/^\s*PRAGMA cipher_version\s*$/i.test(sql)) return { cipher_version: options.cipherVersion ?? "4.6.1 community" } as T;
      ensureUnlocked();
      return (db.prepare(sql).get(...params(values)) as T) ?? null;
    },
    async getAllAsync<T>(sql: string, values?: unknown[]) {
      log(sql);
      ensureUnlocked();
      return db.prepare(sql).all(...params(values)) as T[];
    },
    async closeAsync() {
      if (db.isOpen) db.close();
    },
  };
}

export function createTestPlatform(options: TestPlatformOptions): RcPlatformDeps & { keyStore: ReturnType<typeof createFileKeyStore>; now: { ms: number } } {
  fs.mkdirSync(options.dir, { recursive: true });
  const now = options.now ?? { ms: Date.parse("2026-11-09T07:30:00Z") };
  const full = (name: string) => {
    if (!/^[A-Za-z0-9_.-]{1,160}$/.test(name) || name.includes("..")) throw new Error("Nom de fichier refusé.");
    return path.join(options.dir, name);
  };
  const keyStore = createFileKeyStore(options.keyStoreFile ?? path.join(options.dir, "..", `${path.basename(options.dir)}.securestore.json`));
  return {
    platform: "android",
    openDatabase: async (name) => openNodeConnection(full(name), options),
    keyStore,
    fs: {
      async exists(name) {
        return fs.existsSync(full(name));
      },
      async deleteFile(name) {
        fs.rmSync(full(name), { force: true });
        fs.rmSync(sidecar(full(name)), { force: true });
      },
      async moveFile(from, to) {
        fs.renameSync(full(from), full(to));
        if (fs.existsSync(sidecar(full(from)))) fs.renameSync(sidecar(full(from)), sidecar(full(to)));
      },
      async readHeader(name, length) {
        const file = full(name);
        if (!fs.existsSync(file)) return null;
        const real = fs.readFileSync(file).subarray(0, length);
        if (options.plaintextHeader || !fs.existsSync(sidecar(file))) return new Uint8Array(real);
        // Fichier « chiffré » simulé : en-tête pseudo-aléatoire dérivé de la clé simulée.
        return new Uint8Array(crypto.createHash("sha256").update(fs.readFileSync(sidecar(file))).digest().subarray(0, length));
      },
      async listFiles() {
        return fs.existsSync(options.dir) ? fs.readdirSync(options.dir).filter((name) => !name.endsWith(".simkey")) : [];
      },
      async readText(name) {
        return fs.existsSync(full(name)) ? fs.readFileSync(full(name), "utf8") : null;
      },
      async writeText(name, text) {
        fs.writeFileSync(full(`${name}.tmp`), text);
        fs.renameSync(full(`${name}.tmp`), full(name));
      },
    },
    randomBytes: async (size) => new Uint8Array(crypto.randomBytes(size)),
    randomUUID: () => crypto.randomUUID(),
    nowMs: () => now.ms,
    now,
  };
}
