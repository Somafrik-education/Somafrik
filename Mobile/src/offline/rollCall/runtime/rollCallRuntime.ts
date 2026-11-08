/**
 * NFC-PRES-LOCAL-PR3 — exécution applicative du stockage d'appel hors ligne (PR2).
 *
 * Un seul gestionnaire de comptes (`createRollCallAccountManager`) pour toute l'application :
 *  - démarrage et reprise : `runStartupMaintenance` (purges à échéance, quarantaines) sans ouvrir
 *    aucune base ;
 *  - changement de compte ou d'établissement : la base ouverte est fermée immédiatement ; aucune
 *    base n'est ouverte tant que l'enseignant n'ouvre pas l'appel hors connexion (pas de base
 *    créée pour les comptes qui n'utilisent pas la fonction) ;
 *  - déconnexion : crypto-effacement si rien n'est en attente ; sinon confirmation explicite, puis
 *    `blocked_logout` (contrat PR0 §5.3). Une fin de session forcée (expiration) conserve les appels
 *    en attente, sans effacement.
 *
 * Aucune donnée n'est stockée dans l'Outbox JSON. Aucun journal ne contient d'identifiant, de clé
 * ou de preuve : seulement des codes.
 */
import { resolveL1EnvironmentStorage } from "../../l1/environment";
import { embeddedPackKeyring, type PackKeyring } from "../pack/keyring";
import { UUID } from "../crypto/primitives";
import { createRollCallAccountManager, type RcActivateResult, type RollCallAccountManager } from "../store/accountManager";
import { accountDatabaseExists, type RcIdentity, type RcPlatformDeps } from "../store/database";
import { countPendingSessions } from "../store/repository";
import { createNativeRollCallPlatform } from "../store/nativePlatform";
import { createRollCallSyncRunner, type SyncRunReport, type SyncTransport, type SyncTrigger } from "../sync/syncRunner";

type SessionLike = {
  user?: { id?: string; schoolId?: string } | null;
  school?: { id?: string } | null;
} | null | undefined;

type LogoutGuard = { status: "checking" | "none" | "pending" | "error"; pending: number };

export type LogoutPlan =
  | { kind: "immediate"; identity: RcIdentity | null }
  | { kind: "confirm"; identity: RcIdentity; pending: number }
  | { kind: "confirm_unverified"; identity: RcIdentity };

type RuntimeDeps = {
  platform: RcPlatformDeps | null;
  environment: () => { environmentId: string; releaseProfile: string } | null;
  log?: (event: string, code?: string) => void;
  /** Envoi HTTP du lot figé (NFC-PRES-LOCAL-PR4) ; par défaut la route PR1c via httpClient. */
  transport?: SyncTransport;
  random?: () => number;
};

function defaultTransport(): SyncTransport {
  return (input) => {
    const { sendOfflineRollCallSync } = require("../../../services/rollCallOfflineApi") as typeof import("../../../services/rollCallOfflineApi");
    return sendOfflineRollCallSync(input);
  };
}

function defaultEnvironment(): { environmentId: string; releaseProfile: string } | null {
  try {
    const { getReleaseProfile, resolveApiRootUrl } = require("../../../config/env") as typeof import("../../../config/env");
    const releaseProfile = getReleaseProfile();
    return { environmentId: resolveL1EnvironmentStorage({ releaseProfile, apiRoot: resolveApiRootUrl() }).environmentId, releaseProfile };
  } catch {
    return null;
  }
}

export function createRollCallRuntime(deps: RuntimeDeps) {
  const manager: RollCallAccountManager | null = deps.platform ? createRollCallAccountManager(deps.platform) : null;
  const log = deps.log ?? (() => undefined);

  /** Identité AUTHENTIFIÉE : users.id et établissement de la session, environnement du build. */
  function identityOf(session: SessionLike): RcIdentity | null {
    const env = deps.environment();
    const userId = String(session?.user?.id ?? "").trim().toLowerCase();
    const schoolId = String(session?.school?.id ?? session?.user?.schoolId ?? "").trim().toLowerCase();
    if (!env || !UUID.test(userId) || !UUID.test(schoolId)) return null;
    return { environmentId: env.environmentId, userId, schoolId };
  }

  function sameIdentity(a: RcIdentity | null, b: RcIdentity | null): boolean {
    return !!a && !!b && a.environmentId === b.environmentId && a.userId === b.userId && a.schoolId === b.schoolId;
  }

  // NFC-PRES-LOCAL-PR4 : un seul runner, lié à la base ouverte du compte courant.
  const syncListeners = new Set<() => void>();
  const runner = createRollCallSyncRunner({
    currentAccount: () => {
      const account = manager?.current();
      return account ? { ctx: account.ctx } : null;
    },
    transport: deps.transport ?? defaultTransport(),
    random: deps.random,
    log,
    onChange: () => {
      for (const listener of syncListeners) listener();
    },
  });

  // Dernier état vérifié par compte, pour une décision de déconnexion synchrone.
  const guards = new Map<string, LogoutGuard>();
  const guardSeqs = new Map<string, number>();
  // Incrémentée à chaque déconnexion : une vérification lancée avant ne rouvre ni ne garde rien.
  let logoutEpoch = 0;
  const keyOf = (identity: RcIdentity) => `${identity.environmentId}|${identity.userId}|${identity.schoolId}`;
  const guardFor = (identity: RcIdentity) => guards.get(keyOf(identity)) ?? null;

  /**
   * Appels en attente du compte. Lève `RC_PENDING_UNVERIFIED` si la base existe mais ne peut être
   * ouverte ou lue : une erreur n'est JAMAIS « 0 en attente ».
   */
  async function pendingForLogout(session: SessionLike): Promise<number> {
    if (!manager || !deps.platform) return 0;
    const identity = identityOf(session);
    if (!identity) return 0;
    const current = manager.current();
    if (!sameIdentity(current?.identity ?? null, identity)) {
      if (!(await accountDatabaseExists(deps.platform, identity))) return 0;
      const opened = await manager.activate(identity);
      if (!opened.ok) throw Object.assign(new Error("RC_PENDING_UNVERIFIED"), { code: "RC_PENDING_UNVERIFIED", cause: opened.code });
    }
    const account = manager.current();
    if (!account || !sameIdentity(account.identity, identity)) {
      throw Object.assign(new Error("RC_PENDING_UNVERIFIED"), { code: "RC_PENDING_UNVERIFIED" });
    }
    return countPendingSessions(account.ctx);
  }

  async function refreshLogoutGuard(session: SessionLike): Promise<LogoutGuard | null> {
    const identity = manager ? identityOf(session) : null;
    if (!identity) return null;
    // Une autre base est ouverte (autre compte) : on ne la ferme pas pour vérifier celui-ci.
    const open = manager?.current();
    if (open && !sameIdentity(open.identity, identity)) return guardFor(identity);
    const key = keyOf(identity);
    const seq = (guardSeqs.get(key) ?? 0) + 1;
    guardSeqs.set(key, seq);
    const epoch = logoutEpoch;
    if (!guards.has(key)) guards.set(key, { status: "checking", pending: 0 });
    let next: LogoutGuard;
    try {
      const pending = await pendingForLogout(session);
      next = pending > 0 ? { status: "pending", pending } : { status: "none", pending: 0 };
    } catch (error) {
      log("rc_pending_unverified", String((error as { code?: string })?.code ?? "UNKNOWN"));
      next = { status: "error", pending: 0 };
    }
    if (epoch !== logoutEpoch) {
      // Déconnexion survenue pendant la vérification : la base ouverte entre-temps est refermée.
      const current = manager?.current();
      if (manager && current && sameIdentity(current.identity, identity)) await manager.close().catch(() => undefined);
      return null;
    }
    // Course : un résultat plus ancien n'écrase jamais un plus récent.
    if (guardSeqs.get(key) === seq) guards.set(key, next);
    return guards.get(key) ?? next;
  }

  return {
    available: () => manager !== null,
    identityOf,
    keyring(): PackKeyring | null {
      const env = deps.environment();
      try {
        return env ? embeddedPackKeyring(env.releaseProfile) : null;
      } catch {
        return null;
      }
    },

    async startup(): Promise<void> {
      if (!manager) return;
      try {
        await manager.runStartupMaintenance();
      } catch (error) {
        log("rc_maintenance_failed", String((error as { code?: string })?.code ?? "UNKNOWN"));
      }
    },

    /** Changement de session : la base d'un autre compte est fermée sur-le-champ. */
    async onSessionChanged(session: SessionLike): Promise<void> {
      if (!manager) return;
      const current = manager.current();
      if (current && !sameIdentity(current.identity, identityOf(session))) {
        runner.stop(); // aucune réponse en vol appliquée à la base fermée
        await manager.close();
      }
      await refreshLogoutGuard(session);
      // Retour du même compte : la base existante a été rouverte par la vérification ; envoi des
      // appels en attente (blocked_logout restaurés, syncing interrompus repris à l'identique).
      if (manager.current() && sameIdentity(manager.current()?.identity ?? null, identityOf(session))) {
        void runner.run({ trigger: "login" });
      }
    },

    /**
     * Synchronisation des appels du compte authentifié : uniquement sur sa propre base ouverte,
     * jamais sur celle d'un autre compte. `manual` ignore le backoff (pas l'échéance).
     */
    async requestSync(session: SessionLike, trigger: SyncTrigger): Promise<SyncRunReport | null> {
      if (!manager) return null;
      const identity = identityOf(session);
      const current = manager.current();
      if (!identity || !current || !sameIdentity(current.identity, identity)) return null;
      const report = await runner.run({ trigger });
      // État de déconnexion recalculé seulement si ce compte est toujours le compte courant : jamais
      // de réouverture de sa base au détriment d'un autre compte connecté entre-temps.
      if (sameIdentity(manager.current()?.identity ?? null, identity)) await refreshLogoutGuard(session).catch(() => undefined);
      return report;
    },

    /** Actualisation de l'interface après chaque transition de synchronisation. */
    subscribeSync(listener: () => void): () => void {
      syncListeners.add(listener);
      return () => {
        syncListeners.delete(listener);
      };
    },

    syncBusy: () => runner.busy(),

    /** Ouverture explicite par l'écran d'appel hors connexion, pour le compte authentifié uniquement. */
    async activate(session: SessionLike): Promise<RcActivateResult | { ok: false; code: string; message: string }> {
      if (!manager) return { ok: false, code: "RC_SQLCIPHER_REQUIRED", message: "Appel hors connexion indisponible sur cet appareil." };
      const identity = identityOf(session);
      if (!identity) return { ok: false, code: "RC_IDENTITY_REQUIRED", message: "Identité authentifiée incomplète." };
      const result = await manager.activate(identity);
      if (result.ok) await refreshLogoutGuard(session);
      return result;
    },

    /** Appels en attente du compte (sans créer de base pour un compte qui n'en a pas). */
    pendingForLogout,

    /** Recalcule l'état de déconnexion du compte (après une lecture, une correction, une clôture). */
    refreshLogoutGuard,

    /**
     * Décision SYNCHRONE au moment où l'utilisateur demande la déconnexion. Elle ne lit pas
     * SQLite : elle s'appuie sur le dernier état vérifié pour CE compte.
     *  - `immediate` : aucun appel en attente connu (ou aucun stockage possible) → la session est
     *    vidée sur-le-champ ; le stockage est traité ensuite par `finishLogout`, qui ne détruit
     *    jamais un appel en attente ;
     *  - `confirm` : appel(s) en attente vérifié(s) → confirmation avant toute déconnexion ;
     *  - `confirm_unverified` : la lecture SQLCipher a échoué → jamais interprété comme « 0 en
     *    attente » ; confirmation explicite, rien ne sera effacé.
     */
    planLogout(session: SessionLike): LogoutPlan {
      const identity = manager ? identityOf(session) : null;
      if (!manager || !identity) return { kind: "immediate", identity: null };
      const guard = guardFor(identity);
      if (guard?.status === "pending") return { kind: "confirm", identity, pending: guard.pending };
      if (guard?.status === "error") return { kind: "confirm_unverified", identity };
      // `none` vérifié, ou vérification en cours : déconnexion immédiate ; `finishLogout` recompte
      // sous verrou et conserve tout appel trouvé.
      return { kind: "immediate", identity };
    },

    /**
     * Stockage après la déconnexion (la session est déjà vidée). Effacement uniquement si le
     * gestionnaire compte 0 appel en attente sous son verrou ; tout appel trouvé est conservé en
     * `blocked_logout` ; toute erreur conserve et ferme. N'agit que sur la base du compte déconnecté.
     */
    async finishLogout(plan: LogoutPlan, options: { confirmed: boolean }): Promise<"none" | "erased" | "blocked_logout" | "kept" | "erase_incomplete"> {
      if (!manager || !plan.identity) return "none";
      const identity = plan.identity;
      logoutEpoch += 1;
      runner.stop();
      guards.delete(keyOf(identity));
      const current = manager.current();
      if (!current || !sameIdentity(current.identity, identity)) return "none";
      // Lecture en erreur : aucune tentative d'effacement, base seulement fermée.
      if (plan.kind === "confirm_unverified") {
        await manager.close().catch(() => undefined);
        return "kept";
      }
      try {
        const first = await manager.logout({ confirmPending: plan.kind === "confirm" && options.confirmed });
        if (first.status === "confirmation_required") {
          // Un appel est apparu depuis la décision : il est conservé, jamais effacé.
          const kept = await manager.logout({ confirmPending: true });
          return kept.status === "blocked_logout" ? "blocked_logout" : "kept";
        }
        if (first.status === "no_account") return "none";
        if (first.status === "erase_incomplete") log("rc_erase_incomplete");
        return first.status;
      } catch (error) {
        log("rc_logout_storage_failed", String((error as { code?: string })?.code ?? "UNKNOWN"));
        await manager.close().catch(() => undefined);
        return "kept";
      }
    },

    /**
     * Déconnexion volontaire. `confirmPending` doit venir d'une confirmation explicite de
     * l'utilisateur lorsqu'un appel est en attente.
     */
    async logout(options: { confirmPending: boolean }): Promise<"none" | "erased" | "blocked_logout" | "confirmation_required" | "erase_incomplete"> {
      if (!manager) return "none";
      const result = await manager.logout(options);
      if (result.status === "no_account") return "none";
      if (result.status === "erase_incomplete") log("rc_erase_incomplete");
      return result.status;
    },

    /** Fin de session forcée (expiration) : rien n'est effacé, les appels en attente sont conservés. */
    async forcedLogout(): Promise<void> {
      if (!manager) return;
      logoutEpoch += 1;
      runner.stop();
      guards.clear();
      const result = await manager.logout({ confirmPending: true }).catch(() => null);
      if (!result) await manager.close().catch(() => undefined);
    },

    current: () => manager?.current() ?? null,
  };
}

export type RollCallRuntime = ReturnType<typeof createRollCallRuntime>;

let shared: RollCallRuntime | null = null;

/** Instance applicative unique (Android / iOS ; null sur Web : aucun stockage d'appel). */
export function rollCallRuntime(): RollCallRuntime {
  if (!shared) {
    let platform: RcPlatformDeps | null = null;
    try {
      platform = createNativeRollCallPlatform();
    } catch {
      platform = null;
    }
    shared = createRollCallRuntime({ platform, environment: defaultEnvironment });
  }
  return shared;
}
