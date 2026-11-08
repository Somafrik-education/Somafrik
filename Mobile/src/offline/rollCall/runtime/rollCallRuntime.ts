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

type SessionLike = {
  user?: { id?: string; schoolId?: string } | null;
  school?: { id?: string } | null;
} | null | undefined;

type RuntimeDeps = {
  platform: RcPlatformDeps | null;
  environment: () => { environmentId: string; releaseProfile: string } | null;
  log?: (event: string, code?: string) => void;
};

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
      if (current && !sameIdentity(current.identity, identityOf(session))) await manager.close();
    },

    /** Ouverture explicite par l'écran d'appel hors connexion, pour le compte authentifié uniquement. */
    async activate(session: SessionLike): Promise<RcActivateResult | { ok: false; code: string; message: string }> {
      if (!manager) return { ok: false, code: "RC_SQLCIPHER_REQUIRED", message: "Appel hors connexion indisponible sur cet appareil." };
      const identity = identityOf(session);
      if (!identity) return { ok: false, code: "RC_IDENTITY_REQUIRED", message: "Identité authentifiée incomplète." };
      return manager.activate(identity);
    },

    /** Appels en attente du compte (sans créer de base pour un compte qui n'en a pas). */
    async pendingForLogout(session: SessionLike): Promise<number> {
      if (!manager || !deps.platform) return 0;
      const identity = identityOf(session);
      if (!identity) return 0;
      const current = manager.current();
      if (!sameIdentity(current?.identity ?? null, identity)) {
        if (!(await accountDatabaseExists(deps.platform, identity))) return 0;
        const opened = await manager.activate(identity);
        if (!opened.ok) return 0;
      }
      const account = manager.current();
      return account ? countPendingSessions(account.ctx) : 0;
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
