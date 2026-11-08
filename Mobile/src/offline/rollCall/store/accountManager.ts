/**
 * NFC-PRES-LOCAL-PR2 — cycle de vie des bases d'appel par compte (PR0 §5.3).
 *
 *  - une seule base ouverte à la fois : celle du compte authentifié (environnement × établissement ×
 *    utilisateur) ; changer de compte ferme d'abord la base courante ;
 *  - déconnexion sans appel en attente : crypto-effacement (clé, puis fichier, puis vérification) ;
 *  - déconnexion avec appel en attente : confirmation explicite exigée ; base FERMÉE, sessions en
 *    `blocked_logout`, clé conservée pour la reconnexion du MÊME compte uniquement ;
 *  - échéance : un compte qui ne revient jamais est effacé au démarrage, sans ouvrir sa base ;
 *  - quarantaine : supprimée 7 jours après sa création.
 *
 * Ce module n'est branché sur aucun écran dans PR2 (pas de nouvelle UI, pas de flag) : PR3 l'appellera
 * à la connexion, à la déconnexion et au démarrage. Aucune journalisation de clé ou d'identifiant.
 */
import { advanceTrustedTime } from "../pack/clock";
import { mergeRevocationStates, parseRevocationState, type RevocationState } from "../pack/revocations";
import {
  RC_REGISTRY_FILE,
  keyNameForQuarantineFile,
  parseRcDbFileName,
  parseRegistry,
  rcDbFileName,
  rcDbKeyName,
  removeRegistryAccount,
  upsertRegistryAccount,
  type RcRegistry,
} from "./accountFiles";
import {
  RollCallStorageError,
  deleteDatabaseFiles,
  openRollCallAccountDatabase,
  quarantinePurgeAt,
  type RcIdentity,
  type RcOpenFailure,
  type RcPlatformDeps,
} from "./database";
import {
  blockSessionsForLogout,
  computeAccountPurgeAt,
  countPendingSessions,
  recoverInterruptedSyncs,
  restoreSessionsAfterLogin,
  runPurge,
  type RcContext,
} from "./repository";

export type RcActiveAccount = {
  identity: RcIdentity;
  accountId: string;
  fileName: string;
  keyName: string;
  ctx: RcContext;
  cipherVersion: string;
};

export type RcActivateResult =
  | { ok: true; account: RcActiveAccount; quarantinedCount: number; created: boolean; restored: number }
  | RcOpenFailure;

export type RcLogoutResult =
  | { status: "no_account" }
  | { status: "erased" }
  | { status: "erase_incomplete" }
  | { status: "confirmation_required"; pending: number }
  | { status: "blocked_logout"; pending: number };

export type RcMaintenanceReport = { erasedAccounts: number; deletedQuarantines: number; registeredOrphans: number };

export function createRollCallAccountManager(deps: RcPlatformDeps) {
  let current: RcActiveAccount | null = null;
  let tail: Promise<void> = Promise.resolve();
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  async function loadRegistry(): Promise<RcRegistry> {
    const text = (await deps.fs.readText(RC_REGISTRY_FILE)) ?? (await deps.fs.readText(`${RC_REGISTRY_FILE}.tmp`));
    return parseRegistry(text);
  }

  async function saveRegistry(registry: RcRegistry): Promise<void> {
    await deps.fs.writeText(RC_REGISTRY_FILE, JSON.stringify(registry));
  }

  /** Crypto-effacement : clé supprimée, fichiers supprimés, puis absence vérifiée des deux. */
  async function cryptoErase(environmentId: string, accountId: string): Promise<boolean> {
    const keyName = rcDbKeyName(environmentId, accountId);
    const fileName = rcDbFileName(environmentId, accountId);
    await deps.keyStore.deleteItem(keyName);
    const filesGone = await deleteDatabaseFiles(deps, fileName);
    const keyGone = !String((await deps.keyStore.getItem(keyName)) ?? "").trim();
    return filesGone && keyGone;
  }

  async function closeCurrent(): Promise<void> {
    const account = current;
    current = null;
    if (account) await account.ctx.connection.close();
  }

  async function activateUnlocked(identity: RcIdentity): Promise<RcActivateResult> {
    if (
      current &&
      current.identity.environmentId === identity.environmentId &&
      current.identity.userId === identity.userId &&
      current.identity.schoolId === identity.schoolId
    ) {
      return { ok: true, account: current, quarantinedCount: 0, created: false, restored: 0 };
    }
    // Autre compte : la base courante est fermée AVANT toute ouverture (aucun affichage croisé).
    await closeCurrent();
    const opened = await openRollCallAccountDatabase(deps, identity);
    if (!opened.ok) {
      // Échec visible ; une quarantaine éventuelle est inscrite pour sa purge à 7 jours.
      if (opened.quarantined?.length) await registerQuarantines(opened.quarantined, identity.environmentId);
      return opened;
    }
    const ctx: RcContext = {
      connection: opened.connection,
      identity: { userId: identity.userId, schoolId: identity.schoolId },
      nowMs: deps.nowMs,
      randomUUID: deps.randomUUID,
    };
    const restored = await restoreSessionsAfterLogin(ctx);
    await recoverInterruptedSyncs(ctx);
    await runPurge(ctx);
    const registry = upsertRegistryAccount(await loadRegistry(), {
      accountId: opened.accountId,
      environmentId: identity.environmentId,
      state: "open",
      purgeAtMs: await computeAccountPurgeAt(ctx),
    });
    await saveRegistry(registry);
    current = {
      identity: { ...identity },
      accountId: opened.accountId,
      fileName: opened.connection.fileName,
      keyName: opened.keyName,
      ctx,
      cipherVersion: opened.connection.cipherVersion,
    };
    return { ok: true, account: current, quarantinedCount: opened.quarantined.length, created: opened.created, restored };
  }

  async function registerQuarantines(names: string[], environmentId: string): Promise<void> {
    const registry = await loadRegistry();
    const nowMs = deps.nowMs();
    await saveRegistry({
      ...registry,
      quarantines: [
        ...registry.quarantines,
        ...names.map((fileName) => ({ fileName, environmentId, quarantinedAtMs: nowMs, purgeAtMs: quarantinePurgeAt(nowMs) })),
      ],
    });
  }

  async function logoutUnlocked(options: { confirmPending: boolean }): Promise<RcLogoutResult> {
    const account = current;
    if (!account) return { status: "no_account" };
    const pending = await countPendingSessions(account.ctx);
    if (pending === 0) {
      await closeCurrent();
      const erased = await cryptoErase(account.identity.environmentId, account.accountId);
      if (erased) await saveRegistry(removeRegistryAccount(await loadRegistry(), account.identity.environmentId, account.accountId));
      return { status: erased ? "erased" : "erase_incomplete" };
    }
    if (!options.confirmPending) return { status: "confirmation_required", pending };
    await blockSessionsForLogout(account.ctx);
    const purgeAtMs = await computeAccountPurgeAt(account.ctx);
    await closeCurrent();
    await saveRegistry(
      upsertRegistryAccount(await loadRegistry(), {
        accountId: account.accountId,
        environmentId: account.identity.environmentId,
        state: "blocked_logout",
        purgeAtMs,
      }),
    );
    return { status: "blocked_logout", pending };
  }

  /**
   * Démarrage de l'application, quel que soit le compte : efface les bases arrivées à échéance et
   * les quarantaines de plus de 7 jours. Aucune base n'est ouverte pour cela. Les fichiers d'appel
   * absents du registre (registre perdu) y sont inscrits avec une échéance de 7 jours.
   */
  async function maintenanceUnlocked(): Promise<RcMaintenanceReport> {
    const nowMs = deps.nowMs();
    let registry = await loadRegistry();
    let erasedAccounts = 0;
    let deletedQuarantines = 0;
    let registeredOrphans = 0;
    for (const entry of [...registry.accounts]) {
      const isCurrent = current?.accountId === entry.accountId && current.identity.environmentId === entry.environmentId;
      if (isCurrent || entry.purgeAtMs > nowMs) continue;
      if (await cryptoErase(entry.environmentId, entry.accountId)) {
        registry = removeRegistryAccount(registry, entry.environmentId, entry.accountId);
        erasedAccounts += 1;
      }
    }
    const keptQuarantines = [];
    for (const entry of registry.quarantines) {
      if (entry.purgeAtMs > nowMs) {
        keptQuarantines.push(entry);
        continue;
      }
      const quarantinedKey = keyNameForQuarantineFile(entry.fileName);
      if (quarantinedKey) await deps.keyStore.deleteItem(quarantinedKey);
      if (await deleteDatabaseFiles(deps, entry.fileName)) deletedQuarantines += 1;
      else keptQuarantines.push(entry);
    }
    registry = { ...registry, quarantines: keptQuarantines };
    for (const fileName of await deps.fs.listFiles()) {
      const parsed = parseRcDbFileName(fileName);
      if (parsed && !registry.accounts.some((a) => a.accountId === parsed.accountId && a.environmentId === parsed.environmentId)) {
        registry = upsertRegistryAccount(registry, { ...parsed, state: "closed", purgeAtMs: nowMs + 7 * 24 * 3600 * 1000 });
        registeredOrphans += 1;
      }
      const quarantine = /^(somafrik-rollcall-v1-[A-Za-z0-9_.-]+\.quarantine-\d+)$/.exec(fileName);
      if (quarantine && !registry.quarantines.some((q) => q.fileName === quarantine[1])) {
        const env = parseRcDbFileName(fileName.replace(/\.quarantine-\d+$/, ""))?.environmentId ?? "unknown-00000000";
        registry = {
          ...registry,
          quarantines: [...registry.quarantines, { fileName: quarantine[1], environmentId: env, quarantinedAtMs: nowMs, purgeAtMs: quarantinePurgeAt(nowMs) }],
        };
      }
    }
    await saveRegistry(registry);
    return { erasedAccounts, deletedQuarantines, registeredOrphans };
  }

  return {
    activate: (identity: RcIdentity) => serialize(() => activateUnlocked(identity)),
    logout: (options: { confirmPending: boolean }) => serialize(() => logoutUnlocked(options)),
    runStartupMaintenance: () => serialize(() => maintenanceUnlocked()),
    /** Ferme la base sans rien effacer (mise en arrière-plan, arrêt). */
    close: () => serialize(() => closeCurrent()),
    current: () => current,
    /** Recalcule l'échéance de purge du compte ouvert (après création d'une session). */
    refreshPurgeDeadline: () =>
      serialize(async () => {
        if (!current) return;
        await saveRegistry(
          upsertRegistryAccount(await loadRegistry(), {
            accountId: current.accountId,
            environmentId: current.identity.environmentId,
            state: "open",
            purgeAtMs: await computeAccountPurgeAt(current.ctx),
          }),
        );
      }),
    pendingQuarantines: () => serialize(async () => (await loadRegistry()).quarantines.length),
  };
}

export type RollCallAccountManager = ReturnType<typeof createRollCallAccountManager>;

// ---------------------------------------------------------------------------------------------
// État conservé dans la base du compte : révocations (monotones) et horloge de confiance.
// ---------------------------------------------------------------------------------------------

export const RC_LOCAL_STATE_ERROR = Object.freeze({
  REVOCATIONS_CORRUPT: "RC_PACK_REVOCATIONS_STATE_CORRUPT",
  TRUSTED_TIME_CORRUPT: "RC_TRUSTED_TIME_STATE_CORRUPT",
});

export const RC_META_PACK_REVOCATIONS = "pack_revocations";
export const RC_META_TRUSTED_TIME = "last_trusted_time_ms";
/** Valeurs écrites à la création de la base : leur absence ultérieure est une corruption. */
export const RC_INITIAL_PACK_REVOCATIONS = JSON.stringify({ sequence: 0, revokedKeyIds: [] });
export const RC_INITIAL_TRUSTED_TIME = "0";

const TRUSTED_TIME_TEXT = /^(0|[1-9][0-9]{0,15})$/;

type MetaReader = { getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null> };

async function readMeta(db: MetaReader, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM rc_meta WHERE key = ?", [key]);
  return row ? String(row.value) : null;
}

/**
 * État de révocation conservé. Absent, JSON invalide ou forme inattendue → erreur explicite
 * (fail-closed) : jamais d'état vide de remplacement, qui réautoriserait une clé révoquée.
 */
function parseStoredRevocations(raw: string | null): RevocationState {
  let parsed: unknown;
  try {
    parsed = raw == null ? undefined : JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  const state = parseRevocationState(parsed);
  if (!state) {
    throw new RollCallStorageError(RC_LOCAL_STATE_ERROR.REVOCATIONS_CORRUPT, "État local des révocations illisible : liste hors ligne refusée.");
  }
  return state;
}

/**
 * Horloge de confiance conservée (ms UTC, « 0 » = jamais reçue). Absente ou mal formée → erreur
 * explicite : la protection contre le recul de l'horloge n'est jamais désactivée en silence.
 */
function parseStoredTrustedTime(raw: string | null): number | null {
  if (raw == null || !TRUSTED_TIME_TEXT.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new RollCallStorageError(RC_LOCAL_STATE_ERROR.TRUSTED_TIME_CORRUPT, "Horloge de confiance locale illisible : liste hors ligne refusée.");
  }
  const value = Number(raw);
  return value === 0 ? null : value;
}

export async function loadRevocationState(ctx: RcContext): Promise<RevocationState> {
  return ctx.connection.read(async (db) => parseStoredRevocations(await readMeta(db, RC_META_PACK_REVOCATIONS)));
}

/**
 * Union monotone avec l'état conservé, lue et écrite dans UNE transaction (aucun état
 * intermédiaire après un arrêt brutal). État conservé illisible → erreur, rien n'est écrasé.
 */
export async function saveRevocationState(ctx: RcContext, next: RevocationState): Promise<RevocationState> {
  const incoming = parseRevocationState(next);
  if (!incoming) throw new RollCallStorageError(RC_LOCAL_STATE_ERROR.REVOCATIONS_CORRUPT, "État de révocation à enregistrer invalide.");
  return ctx.connection.transaction(async (db) => {
    const stored = parseStoredRevocations(await readMeta(db, RC_META_PACK_REVOCATIONS));
    const merged = mergeRevocationStates(stored, incoming);
    await db.runAsync("UPDATE rc_meta SET value = ? WHERE key = ?", [JSON.stringify(merged), RC_META_PACK_REVOCATIONS]);
    return merged;
  });
}

export async function loadLastTrustedTime(ctx: RcContext): Promise<number | null> {
  return ctx.connection.read(async (db) => parseStoredTrustedTime(await readMeta(db, RC_META_TRUSTED_TIME)));
}

/** Avance monotone de l'horloge de confiance, lue et écrite dans UNE transaction. */
export async function recordTrustedTime(ctx: RcContext, candidateMs: number | null): Promise<number | null> {
  return ctx.connection.transaction(async (db) => {
    const current = parseStoredTrustedTime(await readMeta(db, RC_META_TRUSTED_TIME));
    const next = advanceTrustedTime(current, candidateMs == null ? null : Math.trunc(candidateMs));
    if (next != null && next !== current && Number.isSafeInteger(next) && next > 0) {
      await db.runAsync("UPDATE rc_meta SET value = ? WHERE key = ?", [String(next), RC_META_TRUSTED_TIME]);
    }
    return next;
  });
}
