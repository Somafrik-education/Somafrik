/**
 * NFC-PRES-LOCAL-PR2 — ouverture d'une base SQLCipher d'appel hors ligne, une par compte.
 *
 * Réutilise la primitive L1 `applySqlCipherKey` (offline/l1/database.ts) : `PRAGMA key`, puis
 * `PRAGMA cipher_version` non vide exigé, sans aucun repli SQLite en clair.
 *
 * Contrôles supplémentaires à l'ouverture (fail-closed) :
 *  1. la clé déverrouille réellement le fichier (`sqlite_master` lisible, `quick_check = ok`) ;
 *  2. après la première écriture, l'en-tête du fichier n'est PAS l'en-tête SQLite en clair
 *     (« SQLite format 3\0 ») : preuve que le fichier est chiffré sur disque ;
 *  3. la base appartient bien au compte et à l'environnement ouverts (`rc_meta`) et ne contient
 *     aucune session d'un autre utilisateur ou établissement.
 *
 * Incidents (décisions fail-closed déjà publiées sur la PR, conservées) — aucune base n'est jamais
 * recréée par-dessus des données, et l'ouverture ÉCHOUE visiblement :
 *  - clé absente pour un fichier existant → quarantaine, `RC_DATABASE_KEY_LOST` ;
 *  - fichier illisible, corrompu, mauvaise clé ou base d'un autre compte → quarantaine,
 *    `RC_DATABASE_UNREADABLE` ;
 *  - clé présente mais fichier disparu → `RC_DATABASE_FILE_LOST`, clé conservée (incident) ;
 *  - clé mal formée → `RC_DATABASE_KEY_INVALID` ;
 *  - sel d'appareil perdu alors que des bases d'appel existent → `RC_ACCOUNT_SALT_LOST`, aucun
 *    nouveau sel (les anciennes bases ne seraient plus identifiables).
 * Après une quarantaine, l'ouverture suivante crée une base neuve. Les blocages FILE_LOST et
 * SALT_LOST sont levés par la purge à échéance (accountManager) : clé et fichiers effacés.
 *
 * Transactions : une seule connexion dédiée par base (`useNewConnection: true`, clé appliquée une
 * fois), toutes les opérations sérialisées dans une file. Chaque écriture est
 * `BEGIN IMMEDIATE … COMMIT` ; une erreur provoque `ROLLBACK` et aucune valeur n'est renvoyée.
 */
import { applySqlCipherKey, type L1OpenDatabase, type L1SqliteLike } from "../../l1/database";
import { bytesToHex, hexToBytes } from "../crypto/bytes";
import { resolveRollCallAccount } from "../accountPartition";
import {
  RC_DB_COMPANION_SUFFIXES,
  RC_DEVICE_SALT_KEY,
  RC_QUARANTINE_RETENTION_MS,
  assertEnvironmentId,
  quarantineKeyName,
  rcDbFileName,
  rcDbKeyName,
} from "./accountFiles";
import { RC_LOCAL_SCHEMA_VERSION, RC_SCHEMA_V1 } from "./schema";

export const RC_STORAGE_ERROR = Object.freeze({
  SQLCIPHER_REQUIRED: "RC_SQLCIPHER_REQUIRED",
  PLAINTEXT_FILE: "RC_SQLCIPHER_PLAINTEXT_FILE",
  IDENTITY_REQUIRED: "RC_IDENTITY_REQUIRED",
  FULL: "RC_STORAGE_FULL",
  CORRUPT: "RC_STORAGE_CORRUPT",
  IO: "RC_STORAGE_IO",
  CONSTRAINT: "RC_STORAGE_CONSTRAINT",
  FAILED: "RC_STORAGE_FAILED",
  CLOSED: "RC_STORAGE_CLOSED",
  KEY_LOST: "RC_DATABASE_KEY_LOST",
  KEY_INVALID: "RC_DATABASE_KEY_INVALID",
  FILE_LOST: "RC_DATABASE_FILE_LOST",
  UNREADABLE: "RC_DATABASE_UNREADABLE",
  SALT_LOST: "RC_ACCOUNT_SALT_LOST",
  SCOPE_INVALID: "RC_ACCOUNT_SCOPE_INVALID",
});
export type RcStorageErrorCode = (typeof RC_STORAGE_ERROR)[keyof typeof RC_STORAGE_ERROR];

export class RollCallStorageError extends Error {
  constructor(
    readonly code: RcStorageErrorCode | string,
    message: string,
  ) {
    // Le code seul (jamais une valeur) : utilisable dans les journaux et les assertions.
    super(`${code}: ${message}`);
    this.name = "RollCallStorageError";
  }
}

/** Classe une erreur SQLite sans recopier son message (qui peut contenir des valeurs). */
export function classifySqliteError(error: unknown): RollCallStorageError {
  if (error instanceof RollCallStorageError) return error;
  const text = String((error as { message?: unknown })?.message ?? error ?? "");
  const own = /\b(RC_[A-Z0-9_]+)\b/.exec(text);
  if (own) return new RollCallStorageError(own[1], "Règle de stockage local refusée.");
  if (/SQLITE_FULL|database or disk is full/i.test(text)) return new RollCallStorageError(RC_STORAGE_ERROR.FULL, "Espace disque insuffisant.");
  if (/SQLITE_CORRUPT|SQLITE_NOTADB|malformed|not a database|file is encrypted/i.test(text)) {
    return new RollCallStorageError(RC_STORAGE_ERROR.CORRUPT, "Base locale illisible.");
  }
  if (/SQLITE_IOERR|disk I\/O error|SQLITE_CANTOPEN|SQLITE_READONLY/i.test(text)) {
    return new RollCallStorageError(RC_STORAGE_ERROR.IO, "Erreur d'écriture sur le stockage.");
  }
  if (/SQLITE_CONSTRAINT|constraint failed/i.test(text)) return new RollCallStorageError(RC_STORAGE_ERROR.CONSTRAINT, "Contrainte locale refusée.");
  return new RollCallStorageError(RC_STORAGE_ERROR.FAILED, "Échec du stockage local.");
}

export type RcKeyStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
};

/** Accès fichiers limité au dossier des bases SQLite de l'application. */
export type RcFileSystem = {
  exists(fileName: string): Promise<boolean>;
  deleteFile(fileName: string): Promise<void>;
  moveFile(fromName: string, toName: string): Promise<void>;
  /** Premiers octets du fichier (null si absent). */
  readHeader(fileName: string, length: number): Promise<Uint8Array | null>;
  listFiles(): Promise<string[]>;
  readText(fileName: string): Promise<string | null>;
  /** Écriture atomique (fichier temporaire puis renommage). */
  writeText(fileName: string, text: string): Promise<void>;
};

export type RcPlatformDeps = {
  platform: string;
  openDatabase: L1OpenDatabase;
  keyStore: RcKeyStore;
  fs: RcFileSystem;
  randomBytes(size: number): Promise<Uint8Array>;
  randomUUID(): string;
  nowMs(): number;
};

export type RcIdentity = { environmentId: string; userId: string; schoolId: string };

export type RcConnection = {
  readonly fileName: string;
  readonly cipherVersion: string;
  /** Lecture sérialisée derrière les écritures en cours. */
  read<T>(fn: (db: L1SqliteLike) => Promise<T>): Promise<T>;
  /** BEGIN IMMEDIATE → fn → COMMIT ; ROLLBACK sur toute erreur, erreur classée renvoyée. */
  transaction<T>(fn: (db: L1SqliteLike) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export type RcOpenedDatabase = {
  ok: true;
  accountId: string;
  keyName: string;
  connection: RcConnection;
  /** Fichiers précédents mis en quarantaine pendant cette ouverture (aucun contenu exposé). */
  quarantined: string[];
  created: boolean;
};
export type RcOpenFailure = {
  ok: false;
  code: RcStorageErrorCode;
  message: string;
  /** Fichiers mis en quarantaine pendant cette tentative (à inscrire au registre). */
  quarantined?: string[];
};

const SQLITE_PLAINTEXT_HEADER = "SQLite format 3\u0000";

function isPlaintextHeader(header: Uint8Array | null): boolean {
  if (!header || header.length < 16) return false;
  for (let i = 0; i < 16; i += 1) if (header[i] !== SQLITE_PLAINTEXT_HEADER.charCodeAt(i)) return false;
  return true;
}

function createConnection(db: L1SqliteLike, fileName: string, cipherVersion: string): RcConnection {
  let tail: Promise<void> = Promise.resolve();
  let closed = false;
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const assertOpen = () => {
    if (closed) throw new RollCallStorageError(RC_STORAGE_ERROR.CLOSED, "Base locale fermée.");
  };
  return {
    fileName,
    cipherVersion,
    read: (fn) =>
      enqueue(async () => {
        assertOpen();
        try {
          return await fn(db);
        } catch (error) {
          throw classifySqliteError(error);
        }
      }),
    transaction: (fn) =>
      enqueue(async () => {
        assertOpen();
        try {
          await db.execAsync("BEGIN IMMEDIATE");
        } catch (error) {
          throw classifySqliteError(error);
        }
        try {
          const result = await fn(db);
          await db.execAsync("COMMIT");
          return result;
        } catch (error) {
          await db.execAsync("ROLLBACK").catch(() => undefined);
          throw classifySqliteError(error);
        }
      }),
    close: () =>
      enqueue(async () => {
        if (closed) return;
        closed = true;
        await db.closeAsync().catch(() => undefined);
      }),
  };
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Une base d'appel (hors quarantaine) existe-t-elle déjà sur l'appareil ? */
async function hasAnyRollCallDatabase(deps: RcPlatformDeps): Promise<boolean> {
  return (await deps.fs.listFiles()).some((name) => /^somafrik-rollcall-v1-.+\.db$/.test(name));
}

async function loadOrCreateDeviceSalt(deps: RcPlatformDeps): Promise<Uint8Array> {
  const stored = String((await deps.keyStore.getItem(RC_DEVICE_SALT_KEY)) ?? "").trim();
  if (stored) {
    if (!HEX64.test(stored)) throw new RollCallStorageError(RC_STORAGE_ERROR.SALT_LOST, "Sel d'appareil invalide.");
    return hexToBytes(stored);
  }
  // Jamais de nouveau sel tant que des bases existantes ne pourraient plus être identifiées.
  if (await hasAnyRollCallDatabase(deps)) {
    throw new RollCallStorageError(RC_STORAGE_ERROR.SALT_LOST, "Sel d'appareil perdu : bases d'appel existantes non identifiables.");
  }
  const created = await deps.randomBytes(32);
  if (!(created instanceof Uint8Array) || created.length !== 32) throw new RollCallStorageError(RC_STORAGE_ERROR.FAILED, "Aléa indisponible.");
  await deps.keyStore.setItem(RC_DEVICE_SALT_KEY, bytesToHex(created));
  return created;
}

/** Calcule l'`accountId` d'une identité authentifiée (sel d'appareil créé au besoin). */
export async function resolveRcAccount(deps: RcPlatformDeps, identity: RcIdentity) {
  assertEnvironmentId(identity.environmentId);
  return resolveRollCallAccount(identity, await loadOrCreateDeviceSalt(deps));
}

/** Renomme la base et ses fichiers compagnons ; ne supprime jamais rien. */
export async function quarantineDatabaseFile(deps: RcPlatformDeps, fileName: string): Promise<string> {
  // Nom unique : une seconde quarantaine dans la même milliseconde n'écrase jamais la première.
  let stamp = deps.nowMs();
  while (await deps.fs.exists(`${fileName}.quarantine-${stamp}`)) stamp += 1;
  const target = `${fileName}.quarantine-${stamp}`;
  for (const suffix of RC_DB_COMPANION_SUFFIXES) {
    if (await deps.fs.exists(`${fileName}${suffix}`)) await deps.fs.moveFile(`${fileName}${suffix}`, `${target}${suffix}`);
  }
  return target;
}

/** Supprime la base et ses fichiers compagnons, puis vérifie qu'il n'en reste rien. */
export async function deleteDatabaseFiles(deps: RcPlatformDeps, fileName: string): Promise<boolean> {
  for (const suffix of RC_DB_COMPANION_SUFFIXES) await deps.fs.deleteFile(`${fileName}${suffix}`);
  for (const suffix of RC_DB_COMPANION_SUFFIXES) if (await deps.fs.exists(`${fileName}${suffix}`)) return false;
  return true;
}

async function openKeyed(deps: RcPlatformDeps, fileName: string, key: string): Promise<{ db: L1SqliteLike; cipherVersion: string }> {
  const db = await deps.openDatabase(fileName, { useNewConnection: true });
  try {
    const cipherVersion = await applySqlCipherKey(db, key);
    return { db, cipherVersion };
  } catch (error) {
    await db.closeAsync().catch(() => undefined);
    throw error;
  }
}

/** La clé déverrouille-t-elle le fichier, et le fichier est-il sain ? */
async function isReadable(db: L1SqliteLike): Promise<boolean> {
  try {
    await db.getFirstAsync("SELECT count(*) AS n FROM sqlite_master");
    const check = await db.getFirstAsync<{ quick_check?: string }>("PRAGMA quick_check");
    return String(check?.quick_check ?? Object.values(check ?? {})[0] ?? "") === "ok";
  } catch {
    return false;
  }
}

async function readMeta(db: L1SqliteLike): Promise<Record<string, string>> {
  const rows = await db.getAllAsync<{ key: string; value: string }>("SELECT key, value FROM rc_meta");
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

async function initialize(db: L1SqliteLike, identity: RcIdentity, accountId: string, nowIso: string): Promise<void> {
  await db.execAsync("PRAGMA foreign_keys = ON");
  await db.execAsync("PRAGMA synchronous = FULL");
  await db.execAsync(RC_SCHEMA_V1);
  await db.execAsync("BEGIN IMMEDIATE");
  try {
    const meta = await readMeta(db);
    if (!meta.schema_version) {
      for (const [key, value] of [
        ["schema_version", String(RC_LOCAL_SCHEMA_VERSION)],
        ["account_id", accountId],
        ["environment_id", identity.environmentId],
        ["created_at", nowIso],
      ]) {
        await db.runAsync("INSERT INTO rc_meta (key, value) VALUES (?, ?)", [key, value]);
      }
    }
    await db.execAsync("COMMIT");
  } catch (error) {
    await db.execAsync("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/** La base ouverte appartient-elle au compte demandé, sans aucune ligne d'un autre compte ? */
async function belongsTo(db: L1SqliteLike, identity: RcIdentity, accountId: string): Promise<boolean> {
  const meta = await readMeta(db);
  if (meta.account_id !== accountId || meta.environment_id !== identity.environmentId) return false;
  if (Number(meta.schema_version) !== RC_LOCAL_SCHEMA_VERSION) return false;
  const foreign = await db.getFirstAsync<{ n: number }>(
    "SELECT count(*) AS n FROM rc_sessions WHERE user_id <> ? OR school_id <> ?",
    [identity.userId, identity.schoolId],
  );
  return Number(foreign?.n ?? 0) === 0;
}

/**
 * Ouvre (ou crée) la base du compte authentifié. Aucune base n'est jamais recréée par-dessus un
 * fichier existant : tout incident est refusé visiblement (voir l'en-tête).
 */
export async function openRollCallAccountDatabase(
  deps: RcPlatformDeps,
  identity: RcIdentity,
): Promise<RcOpenedDatabase | RcOpenFailure> {
  const failure = (code: RcStorageErrorCode, message: string, quarantined?: string[]): RcOpenFailure => ({
    ok: false,
    code,
    message,
    ...(quarantined?.length ? { quarantined } : {}),
  });
  if (deps.platform !== "android" && deps.platform !== "ios") {
    return failure(RC_STORAGE_ERROR.SQLCIPHER_REQUIRED, "SQLCipher natif requis : aucune base d'appel créée.");
  }
  for (const field of ["environmentId", "userId", "schoolId"] as const) {
    if (!String(identity?.[field] ?? "").trim()) {
      return failure(RC_STORAGE_ERROR.IDENTITY_REQUIRED, "Identité authentifiée incomplète : aucune base ouverte.");
    }
  }
  let account: { accountId: string; fileName: string; keyName: string };
  try {
    account = await resolveRcAccount(deps, identity);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === RC_STORAGE_ERROR.SALT_LOST) return failure(RC_STORAGE_ERROR.SALT_LOST, "Sel d'appareil perdu : appel hors ligne bloqué.");
    return failure(RC_STORAGE_ERROR.SCOPE_INVALID, "Identité hors du format attendu : aucune base ouverte.");
  }
  const { accountId, fileName, keyName } = account;
  const key = String((await deps.keyStore.getItem(keyName)) ?? "").trim();
  const fileExists = await deps.fs.exists(fileName);

  if (!key && fileExists) {
    // Clé perdue (réinstallation, SecureStore effacé) : le fichier n'est plus lisible par personne.
    const moved = await quarantineDatabaseFile(deps, fileName);
    return failure(RC_STORAGE_ERROR.KEY_LOST, "Clé de la base d'appel perdue : appels locaux illisibles, à saisir manuellement.", [moved]);
  }
  if (key && !fileExists) {
    // Suppression externe ou arrêt entre la création de la clé et la base : jamais de base vide de remplacement.
    return failure(RC_STORAGE_ERROR.FILE_LOST, "Base d'appel introuvable : incident à signaler, aucune base recréée.");
  }
  if (key && !HEX64.test(key)) {
    return failure(RC_STORAGE_ERROR.KEY_INVALID, "Clé de la base d'appel invalide : aucune ouverture.");
  }

  if (key && fileExists) {
    let opened: { db: L1SqliteLike; cipherVersion: string };
    try {
      opened = await openKeyed(deps, fileName, key);
    } catch (error) {
      if ((error as { code?: string })?.code === "L1_SQLCIPHER_REQUIRED") {
        return failure(RC_STORAGE_ERROR.SQLCIPHER_REQUIRED, "SQLCipher absent : aucune base d'appel ouverte.");
      }
      throw classifySqliteError(error);
    }
    let owned = false;
    if (await isReadable(opened.db)) {
      try {
        await opened.db.execAsync("PRAGMA foreign_keys = ON");
        await opened.db.execAsync("PRAGMA synchronous = FULL");
        owned = await belongsTo(opened.db, identity, accountId);
      } catch {
        owned = false;
      }
    }
    if (owned) {
      return { ok: true, accountId, keyName, connection: createConnection(opened.db, fileName, opened.cipherVersion), quarantined: [], created: false };
    }
    await opened.db.closeAsync().catch(() => undefined);
    const moved = await quarantineDatabaseFile(deps, fileName);
    // La clé suit le fichier en quarantaine (même suffixe) : rien n'est détruit avant l'échéance de
    // 7 jours, et la prochaine ouverture crée une base neuve avec sa propre clé.
    await deps.keyStore.setItem(quarantineKeyName(keyName, moved), key);
    await deps.keyStore.deleteItem(keyName);
    return failure(RC_STORAGE_ERROR.UNREADABLE, "Base d'appel illisible : mise en quarantaine, appels à saisir manuellement.", [moved]);
  }

  // Création : nouvelle clé de 256 bits ; en cas d'échec, ni clé orpheline ni fichier ne restent.
  const bytes = await deps.randomBytes(32);
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new RollCallStorageError(RC_STORAGE_ERROR.FAILED, "Aléa indisponible.");
  const newKey = bytesToHex(bytes);
  await deps.keyStore.setItem(keyName, newKey);
  const abandon = async () => {
    await deleteDatabaseFiles(deps, fileName).catch(() => false);
    await deps.keyStore.deleteItem(keyName).catch(() => undefined);
  };
  let created: { db: L1SqliteLike; cipherVersion: string };
  try {
    created = await openKeyed(deps, fileName, newKey);
  } catch (error) {
    await abandon();
    if ((error as { code?: string })?.code === "L1_SQLCIPHER_REQUIRED") {
      return failure(RC_STORAGE_ERROR.SQLCIPHER_REQUIRED, "SQLCipher absent : aucune base d'appel créée.");
    }
    throw classifySqliteError(error);
  }
  try {
    await initialize(created.db, identity, accountId, new Date(deps.nowMs()).toISOString());
  } catch (error) {
    await created.db.closeAsync().catch(() => undefined);
    await abandon();
    throw classifySqliteError(error);
  }
  // Preuve de chiffrement sur disque : l'en-tête ne doit pas être celui d'un fichier SQLite en clair.
  const header = await deps.fs.readHeader(fileName, 16);
  if (!header || isPlaintextHeader(header)) {
    await created.db.closeAsync().catch(() => undefined);
    await abandon();
    return failure(RC_STORAGE_ERROR.PLAINTEXT_FILE, "Fichier non chiffré détecté : base supprimée, aucun appel enregistré.");
  }
  return { ok: true, accountId, keyName, connection: createConnection(created.db, fileName, created.cipherVersion), quarantined: [], created: true };
}

export function quarantinePurgeAt(quarantinedAtMs: number): number {
  return quarantinedAtMs + RC_QUARANTINE_RETENTION_MS;
}
