/**
 * PR2 — account-scoped SQLCipher opening. Dependencies injected for native and test hosts.
 * Never silently recreate an existing database after SecureStore key loss.
 */
import { resolveRollCallAccount, type RollCallAccount, type Sha256Async } from "./accountPartition";
import { applyRollCallSchemaV1, type RollCallSqlite } from "./schema";

export interface SecureRollCallDb extends RollCallSqlite {
  closeAsync(): Promise<void>;
}
export interface RollCallSecureStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface RollCallFileSystem {
  exists(fileName: string): Promise<boolean>;
  remove(fileName: string): Promise<void>;
  quarantine(fileName: string): Promise<void>;
  hasAnyRollCallDatabase(): Promise<boolean>;
}
export interface RollCallSecureDeps {
  secure: RollCallSecureStore;
  files: RollCallFileSystem;
  openDatabase(fileName: string): Promise<SecureRollCallDb>;
  randomBytes(size: number): Promise<Uint8Array>;
  sha256: Sha256Async;
}
export type OpenRollCallAccount = {
  accountId: string;
  fileName: string;
  db: SecureRollCallDb;
  close(): Promise<void>;
};

const SALT_KEY = "somafrik.rollCallDeviceSaltV1";
const HEX64 = /^[a-f0-9]{64}$/;
function toHex(value: Uint8Array): string {
  return Array.from(value, (n) => n.toString(16).padStart(2, "0")).join("");
}
function fromHex(value: string): Uint8Array {
  if (!HEX64.test(value)) throw new Error("RC_SECURE_SALT_INVALID");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
function fail(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

export function createRollCallSecureManager(deps: RollCallSecureDeps) {
  let current: OpenRollCallAccount | null = null;
  let tail: Promise<void> = Promise.resolve();
  function serialized<T>(run: () => Promise<T>): Promise<T> {
    const next = tail.catch(() => undefined).then(run);
    tail = next.then(() => undefined, () => undefined);
    return next;
  }
  async function getSalt(): Promise<Uint8Array> {
    const existing = await deps.secure.get(SALT_KEY);
    if (existing !== null) return fromHex(existing);
    // Never generate a new salt when existing files can no longer be identified.
    if (await deps.files.hasAnyRollCallDatabase()) {
      throw fail("RC_ACCOUNT_SALT_LOST");
    }
    const random = await deps.randomBytes(32);
    if (random.length !== 32) throw fail("RC_RANDOM_UNAVAILABLE");
    await deps.secure.put(SALT_KEY, toHex(random));
    return random;
  }
  async function generateKey(): Promise<string> {
    const bytes = await deps.randomBytes(32);
    if (bytes.length !== 32) throw fail("RC_RANDOM_UNAVAILABLE");
    return toHex(bytes);
  }
  async function closeCurrent(): Promise<void> {
    if (!current) return;
    const active = current;
    current = null;
    await active.db.closeAsync();
  }

  return {
    open(account: RollCallAccount): Promise<OpenRollCallAccount> {
      return serialized(async () => {
        const salt = await getSalt();
        const partition = await resolveRollCallAccount(account, salt, deps.sha256);
        if (current?.accountId === partition.accountId) return current;
        await closeCurrent();
        const existed = await deps.files.exists(partition.fileName);
        let key = await deps.secure.get(partition.keyName);
        if (!key && existed) {
          await deps.files.quarantine(partition.fileName);
          throw fail("RC_DATABASE_KEY_LOST");
        }
        if (key && !HEX64.test(key)) {
          // Corrupt key never reinterpreted as a valid passphrase.
          throw fail("RC_DATABASE_KEY_INVALID");
        }
        if (!key) {
          key = await generateKey();
          await deps.secure.put(partition.keyName, key);
        }
        const db = await deps.openDatabase(partition.fileName);
        try {
          // Strictly validated hex passphrase. SQLCipher must acknowledge cipher_version.
          await db.execAsync("PRAGMA key = '" + key + "'");
          const row = await db.getFirstAsync<{ cipher_version?: string }>("PRAGMA cipher_version");
          if (!String(row?.cipher_version ?? "").trim()) {
            throw fail("RC_SQLCIPHER_REQUIRED");
          }
          await applyRollCallSchemaV1(db);
          const opened: OpenRollCallAccount = {
            accountId: partition.accountId,
            fileName: partition.fileName,
            db,
            close: () => serialized(async () => {
              if (current?.accountId === partition.accountId) await closeCurrent();
            }),
          };
          current = opened;
          return opened;
        } catch (error) {
          await db.closeAsync().catch(() => undefined);
          // Key existed and DB opened but schema failed: don't destroy / overwrite.
          // The caller will show a visible error and may quarantine by policy.
          if (!existed) await deps.files.remove(partition.fileName).catch(() => undefined);
          throw error;
        }
      });
    },
    close(): Promise<void> {
      return serialized(closeCurrent);
    },
    cryptoErase(account: RollCallAccount): Promise<void> {
      return serialized(async () => {
        const partition = await resolveRollCallAccount(account, await getSalt(), deps.sha256);
        if (current?.accountId === partition.accountId) await closeCurrent();
        // Crypto-erasure order is important: key first, file second.
        await deps.secure.remove(partition.keyName);
        await deps.files.remove(partition.fileName);
      });
    },
  };
}
