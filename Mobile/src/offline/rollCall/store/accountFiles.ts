/**
 * NFC-PRES-LOCAL-PR2 — noms de fichiers, noms de clés et registre d'échéances des bases de compte.
 *
 * PR0 §5.2 :
 *  - fichier  `somafrik-rollcall-v1-<environmentId>-<accountId>.db` ;
 *  - clé      SecureStore `somafrik.rollCallDbKeyV1.<environmentId>.<accountId>` ;
 *  - `accountId` pseudonyme (HMAC du sel d'appareil) : aucun identifiant personnel en clair.
 *
 * PR0 §5.3 : la purge d'un compte qui ne se reconnecte jamais se fait SANS ouvrir sa base, à partir
 * d'une métadonnée non sensible conservée hors base : ce registre (accountId, environnement,
 * échéance). Il ne contient ni nom, ni identifiant d'utilisateur ou d'établissement, ni clé.
 */

export const RC_DEVICE_SALT_KEY = "somafrik.rollCallDeviceSaltV1";
export const RC_DB_KEY_PREFIX = "somafrik.rollCallDbKeyV1";
export const RC_DB_FILE_PREFIX = "somafrik-rollcall-v1-";
export const RC_REGISTRY_FILE = "somafrik-rollcall-v1-registry.json";
export const RC_QUARANTINE_RETENTION_MS = 7 * 24 * 3600 * 1000;

const ENVIRONMENT_ID = /^[a-z]+-[0-9a-f]{8}$/;
const ACCOUNT_ID = /^[A-Za-z0-9_-]{23}$/;
const DB_FILE = /^somafrik-rollcall-v1-([a-z]+-[0-9a-f]{8})-([A-Za-z0-9_-]{23})\.db$/;

export function assertEnvironmentId(value: unknown): string {
  if (typeof value !== "string" || !ENVIRONMENT_ID.test(value)) throw new Error("Environnement d'appel hors ligne invalide.");
  return value as string;
}

export function assertAccountId(value: string): string {
  if (typeof value !== "string" || !ACCOUNT_ID.test(value)) throw new Error("Compte d'appel hors ligne invalide.");
  return value;
}

export function rcDbFileName(environmentId: string, accountId: string): string {
  return `${RC_DB_FILE_PREFIX}${assertEnvironmentId(environmentId)}-${assertAccountId(accountId)}.db`;
}

export function rcDbKeyName(environmentId: string, accountId: string): string {
  return `${RC_DB_KEY_PREFIX}.${assertEnvironmentId(environmentId)}.${assertAccountId(accountId)}`;
}

/** Inverse de `rcDbFileName` : permet de retrouver et purger une base orpheline sans registre. */
export function parseRcDbFileName(fileName: string): { environmentId: string; accountId: string } | null {
  const match = DB_FILE.exec(String(fileName ?? ""));
  return match ? { environmentId: match[1], accountId: match[2] } : null;
}

/** Nom SecureStore de la clé d'une base mise en quarantaine (même suffixe que le fichier). */
export function quarantineKeyName(keyName: string, quarantineFileName: string): string {
  const stamp = /\.quarantine-(\d+)$/.exec(quarantineFileName);
  if (!stamp) throw new Error("Quarantaine invalide.");
  return `${keyName}.quarantine-${stamp[1]}`;
}

/** Clé associée à un fichier de quarantaine, déduite de son nom ; null si le nom est inconnu. */
export function keyNameForQuarantineFile(quarantineFileName: string): string | null {
  const match = /^(somafrik-rollcall-v1-.+\.db)\.quarantine-(\d+)$/.exec(quarantineFileName);
  const parsed = match ? parseRcDbFileName(match[1]) : null;
  return parsed ? `${rcDbKeyName(parsed.environmentId, parsed.accountId)}.quarantine-${match![2]}` : null;
}

/** Fichiers compagnons SQLite (journal de restauration, WAL) à déplacer ou supprimer avec la base. */
export const RC_DB_COMPANION_SUFFIXES = ["", "-journal", "-wal", "-shm"] as const;

export type RcRegistryAccount = {
  accountId: string;
  environmentId: string;
  /** open : base du compte connecté ; blocked_logout : fermée avec appels en attente. */
  state: "open" | "blocked_logout" | "closed";
  /** Échéance de crypto-effacement (ms UTC) : max(syncDeadline) + 7 jours. */
  purgeAtMs: number;
};
export type RcRegistryQuarantine = { fileName: string; environmentId: string; quarantinedAtMs: number; purgeAtMs: number };
export type RcRegistry = { version: 1; accounts: RcRegistryAccount[]; quarantines: RcRegistryQuarantine[] };

export const EMPTY_REGISTRY: RcRegistry = Object.freeze({ version: 1, accounts: [], quarantines: [] }) as RcRegistry;

/** Lecture stricte : toute entrée mal formée est ignorée (jamais interprétée). */
export function parseRegistry(text: string | null): RcRegistry {
  if (!text) return { version: 1, accounts: [], quarantines: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { version: 1, accounts: [], quarantines: [] };
  }
  const value = raw as { version?: unknown; accounts?: unknown; quarantines?: unknown };
  if (!value || value.version !== 1) return { version: 1, accounts: [], quarantines: [] };
  const accounts = (Array.isArray(value.accounts) ? value.accounts : []).filter(
    (entry): entry is RcRegistryAccount =>
      !!entry &&
      typeof entry.accountId === "string" &&
      ACCOUNT_ID.test(entry.accountId) &&
      typeof entry.environmentId === "string" &&
      ENVIRONMENT_ID.test(entry.environmentId) &&
      ["open", "blocked_logout", "closed"].includes(entry.state) &&
      Number.isSafeInteger(entry.purgeAtMs),
  );
  const quarantines = (Array.isArray(value.quarantines) ? value.quarantines : []).filter(
    (entry): entry is RcRegistryQuarantine =>
      !!entry &&
      typeof entry.fileName === "string" &&
      /^somafrik-rollcall-v1-[A-Za-z0-9_.-]+\.quarantine-\d+$/.test(entry.fileName) &&
      typeof entry.environmentId === "string" &&
      Number.isSafeInteger(entry.quarantinedAtMs) &&
      Number.isSafeInteger(entry.purgeAtMs),
  );
  return { version: 1, accounts, quarantines };
}

export function upsertRegistryAccount(registry: RcRegistry, entry: RcRegistryAccount): RcRegistry {
  return {
    ...registry,
    accounts: [...registry.accounts.filter((account) => account.accountId !== entry.accountId || account.environmentId !== entry.environmentId), entry],
  };
}

export function removeRegistryAccount(registry: RcRegistry, environmentId: string, accountId: string): RcRegistry {
  return {
    ...registry,
    accounts: registry.accounts.filter((account) => account.accountId !== accountId || account.environmentId !== environmentId),
  };
}
