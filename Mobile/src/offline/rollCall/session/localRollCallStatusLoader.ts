/**
 * NFC-STATUT-PRESENCE-01 (revue CTO) — chargeur des statuts NFC locaux de l'écran des présences,
 * isolé par portée : environnement / établissement / compte / classe / date.
 *
 * Garanties :
 *  - aucune base n'est ouverte : seule la base DÉJÀ active est lue, et seulement si son identité
 *    est exactement celle de la portée demandée ;
 *  - chaque lecture porte un numéro de génération ; un changement de portée, une annulation ou
 *    une lecture plus récente invalide les lectures en cours ;
 *  - après l'`await` SQLCipher, la génération, la portée ET le compte actif (même base, même
 *    identité) sont revérifiés juste avant d'appliquer le résultat ; sinon le résultat est jeté ;
 *  - le résultat est toujours étiqueté par sa clé de portée : l'écran n'affiche que des statuts
 *    dont la clé est celle de la portée courante (purge synchrone au changement de portée).
 */
import type { RcIdentity } from "../store/database";
import type { AttendanceStatus } from "../../../lib/attendanceTruth";
import type { RcContext } from "../store/repository";
import { loadLocalRollCallStatuses } from "./localRollCallStatuses";

export type LocalRollCallScope = RcIdentity & { classId: string; date: string };
export type LocalRollCallStudents = Parameters<typeof loadLocalRollCallStatuses>[1]["students"];
type ActiveAccount = { identity: RcIdentity; ctx: RcContext };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Clé de portée stable, ou null si un élément manque (rien n'est alors lu ni affiché). */
export function localRollCallScopeKey(scope: Partial<LocalRollCallScope> | null | undefined): string | null {
  const environmentId = String(scope?.environmentId ?? "").trim();
  const schoolId = String(scope?.schoolId ?? "").trim().toLowerCase();
  const userId = String(scope?.userId ?? "").trim().toLowerCase();
  const classId = String(scope?.classId ?? "").trim().toLowerCase();
  const date = String(scope?.date ?? "").trim();
  if (!environmentId || !UUID.test(schoolId) || !UUID.test(userId) || !classId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return [environmentId, schoolId, userId, classId, date].join("|");
}

function sameIdentity(account: ActiveAccount | null, scope: LocalRollCallScope): boolean {
  return !!account
    && account.identity.environmentId === scope.environmentId
    && account.identity.schoolId.toLowerCase() === scope.schoolId.toLowerCase()
    && account.identity.userId.toLowerCase() === scope.userId.toLowerCase();
}

export type LocalStatusesResult = { scopeKey: string; statuses: Record<string, AttendanceStatus> };

export function createLocalRollCallStatusLoader(deps: {
  currentAccount: () => ActiveAccount | null;
  apply: (result: LocalStatusesResult) => void;
  read?: typeof loadLocalRollCallStatuses;
}) {
  const read = deps.read ?? loadLocalRollCallStatuses;
  let generation = 0;
  let scope: LocalRollCallScope | null = null;
  let scopeKey: string | null = null;

  return {
    /** Nouvelle portée : toute lecture en cours est invalidée. Renvoie la clé (null = rien à lire). */
    setScope(next: LocalRollCallScope | null): string | null {
      const key = localRollCallScopeKey(next);
      if (key !== scopeKey) generation += 1;
      scope = key && next ? { ...next, classId: next.classId.toLowerCase() } : null;
      scopeKey = key;
      return key;
    },

    /** Invalide toute lecture en cours (fermeture d'écran, déconnexion). */
    cancel(): void {
      generation += 1;
      scope = null;
      scopeKey = null;
    },

    /** Lit les statuts locaux de la portée courante ; jamais appliqués hors de cette portée. */
    async reload(students: LocalRollCallStudents): Promise<"applied" | "stale" | "no_scope" | "other_account"> {
      const current = scope;
      const key = scopeKey;
      generation += 1;
      const mine = generation;
      if (!current || !key) return "no_scope";
      const account = deps.currentAccount();
      if (!sameIdentity(account, current)) {
        // Base d'un autre compte (ou aucune) : rien n'est lu ; la portée n'affiche rien.
        deps.apply({ scopeKey: key, statuses: {} });
        return "other_account";
      }
      const statuses = await read((account as ActiveAccount).ctx, { classId: current.classId, date: current.date, students });
      const after = deps.currentAccount();
      if (mine !== generation || key !== scopeKey) return "stale";
      if (!after || after.ctx !== (account as ActiveAccount).ctx || !sameIdentity(after, current)) return "stale";
      deps.apply({ scopeKey: key, statuses });
      return "applied";
    },
  };
}

/**
 * Affichage : uniquement les statuts étiquetés par la portée COURANTE. Une réponse d'une autre
 * portée (ancien compte, autre classe, autre jour) n'est jamais montrée, même un seul rendu.
 */
export function statusesForScope(result: LocalStatusesResult | null, currentKey: string | null): Record<string, AttendanceStatus> {
  return result && currentKey && result.scopeKey === currentKey ? result.statuses : {};
}

/** Notification après COMMIT : différée, jamais attendue par la boucle de lecture NFC. */
export function notifyWithoutBlocking(callback: (() => void) | undefined, schedule: (fn: () => void) => void = (fn) => setTimeout(fn, 0)): void {
  if (!callback) return;
  schedule(() => {
    try {
      callback();
    } catch {
      // l'écran des présences ne doit jamais interrompre l'appel
    }
  });
}
