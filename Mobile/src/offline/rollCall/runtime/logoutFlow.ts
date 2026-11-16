/**
 * NFC-PRES-LOCAL-PR3 — déconnexion volontaire et appels hors connexion (contrat PR0 §5.3).
 *
 * Contrat MP-011 préservé : sans appel en attente connu, la session est vidée IMMÉDIATEMENT et de
 * façon synchrone (`clearNow`), sans attendre SQLite. Le stockage d'appel est traité ensuite, sans
 * jamais effacer un appel en attente.
 *
 * Confirmation avant la déconnexion uniquement si le dernier état vérifié du compte signale un appel
 * en attente, ou si sa lecture SQLCipher a échoué (jamais interprété comme « 0 en attente » ; rien
 * n'est alors effacé). Annulation : l'utilisateur reste connecté. Une seule demande à la fois
 * (double clic) ; une confirmation donnée après un changement de session est ignorée.
 */
import type { LogoutPlan, RollCallRuntime } from "./rollCallRuntime";

type SessionLike = Parameters<RollCallRuntime["planLogout"]>[0];

export type LogoutConfirmation =
  | { kind: "pending"; pending: number }
  | { kind: "unverified" };

export const LOGOUT_COPY = {
  pendingTitle: "Appel non synchronisé",
  pendingMessage: (pending: number) =>
    `${pending} appel(s) enregistré(s) sur ce téléphone ne sont pas encore synchronisés. Ils seront conservés, fermés, et repris à votre prochaine connexion avec ce compte.`,
  unverifiedTitle: "Vérification impossible",
  unverifiedMessage:
    "Les appels enregistrés sur ce téléphone n'ont pas pu être vérifiés. Rien ne sera effacé : ils seront conservés et repris à votre prochaine connexion avec ce compte.",
  stay: "Rester connecté",
  leave: "Se déconnecter",
} as const;

export type LogoutFlowDeps = {
  runtime: Pick<RollCallRuntime, "planLogout" | "finishLogout">;
  getSession: () => SessionLike;
  /** Affiche la confirmation ; résout `true` uniquement sur « Se déconnecter ». */
  confirm: (request: LogoutConfirmation) => Promise<boolean>;
  log?: (event: string) => void;
};

export type LogoutRequestResult = "logged_out" | "awaiting_confirmation" | "ignored";

export function createLogoutFlow(deps: LogoutFlowDeps) {
  let inFlight = false;

  function finish(plan: LogoutPlan, confirmed: boolean): Promise<unknown> {
    return deps.runtime.finishLogout(plan, { confirmed }).catch(() => deps.log?.("rc_logout_storage_failed"));
  }

  return {
    /**
     * `clearNow` vide la session (mémoire, SecureStore via logoutSession). Appelée de façon
     * synchrone lorsqu'aucune confirmation n'est requise.
     */
    request(clearNow: () => void): { result: LogoutRequestResult; storage: Promise<unknown> } {
      if (inFlight) return { result: "ignored", storage: Promise.resolve() };
      const session = deps.getSession();
      let plan: LogoutPlan;
      try {
        plan = deps.runtime.planLogout(session);
      } catch {
        // Décision impossible : déconnexion immédiate, stockage non touché (identité nulle → rien
        // n'est fermé ni effacé ; la maintenance s'en charge).
        plan = { kind: "immediate", identity: null };
      }
      if (plan.kind === "immediate") {
        clearNow();
        return { result: "logged_out", storage: finish(plan, false) };
      }
      inFlight = true;
      const request: LogoutConfirmation = plan.kind === "confirm" ? { kind: "pending", pending: plan.pending } : { kind: "unverified" };
      const storage = deps
        .confirm(request)
        .catch(() => false)
        .then(async (confirmed) => {
          // Session changée pendant la confirmation (expiration, autre compte) : rien n'est fait.
          if (!confirmed || deps.getSession() !== session) return;
          clearNow();
          await finish(plan, true);
        })
        .finally(() => {
          inFlight = false;
        });
      return { result: "awaiting_confirmation", storage };
    },
    busy: () => inFlight,
  };
}
