/**
 * PRES-LOCAL-NAV-01 — « Démarrer l'appel NFC/QR » depuis une classe DÉJÀ ouverte sur l'écran
 * Présences : l'appel local s'ouvre directement sur cette classe, sans seconde sélection.
 *
 * Aucune autorisation nouvelle : la classe ouverte n'est retenue que si elle figure dans la liste
 * serveur des classes ouvertes à l'appel pour CE compte (même contrat que le sélecteur, le pack et
 * la synchronisation : GET …/roll-call/offline/v1/classes). Sinon — classe absente, liste
 * indisponible sans copie du compte, identifiant non canonique — le sélecteur habituel s'ouvre.
 *
 * Hors connexion (PRES-LOCAL-NAV-01, revue CTO) : dernière liste obtenue pour CE compte et CET
 * établissement, en mémoire du processus seulement (jamais persistée), partagée avec le sélecteur et
 * soumise à une expiration explicite (`ROLL_CALL_CLASS_LIST_TTL_MS`). Elle ne sert QUE si le serveur
 * est injoignable (réseau, délai, 5xx). Une réponse 4xx du serveur — droits retirés (401/403), route
 * absente — fait foi : la copie du compte est purgée et rien n'est ouvert hors sélecteur. Le serveur
 * revérifie tout au pack et à la synchronisation.
 */
import type { RollCallClassOption } from "../services/rollCallOfflineApi";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Durée maximale d'usage hors connexion d'une liste (une journée de classe). */
export const ROLL_CALL_CLASS_LIST_TTL_MS = 12 * 60 * 60 * 1000;

/** Dernière liste par compte + établissement (jamais partagée entre comptes). */
const lastLists = new Map<string, { classes: RollCallClassOption[]; at: number }>();

export type RollCallClassList = { classes: RollCallClassOption[]; cached: boolean };

/**
 * Le serveur a répondu (4xx) : décision d'autorisation qui fait foi. Réseau, délai, serveur
 * injoignable ou 5xx : pas de décision, la copie récente du compte peut servir.
 */
export function isAuthoritativeRollCallListRefusal(error: unknown): boolean {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  return typeof status === "number" && status >= 400 && status < 500;
}

/**
 * Liste des classes ouvertes à l'appel : réseau d'abord, puis dernière liste NON EXPIRÉE du MÊME
 * compte si le serveur est injoignable. Rejette sinon (refus serveur, aucune copie, copie expirée).
 */
export async function loadRollCallClasses(
  scopeKey: string,
  fetchClasses: () => Promise<{ classes: RollCallClassOption[] }>,
  now: () => number = Date.now,
): Promise<RollCallClassList> {
  try {
    const result = await fetchClasses();
    if (scopeKey) lastLists.set(scopeKey, { classes: result.classes, at: now() });
    return { classes: result.classes, cached: false };
  } catch (error) {
    if (isAuthoritativeRollCallListRefusal(error)) {
      if (scopeKey) lastLists.delete(scopeKey);
      throw error;
    }
    const cached = scopeKey ? lastLists.get(scopeKey) : undefined;
    const age = cached ? now() - cached.at : Number.POSITIVE_INFINITY;
    if (cached && age >= 0 && age <= ROLL_CALL_CLASS_LIST_TTL_MS) return { classes: cached.classes, cached: true };
    if (cached && scopeKey) lastLists.delete(scopeKey);
    throw error;
  }
}

/** Identifiant canonique de la classe (UUID en minuscules, comme la liste serveur), sinon "". */
export function canonicalRollCallClassId(classId: unknown): string {
  const value = String(classId ?? "").trim().toLowerCase();
  return UUID.test(value) ? value : "";
}

export type DirectRollCallTarget = { classId: string; className: string };

/**
 * Classe ouverte → cible de l'appel local, uniquement si le serveur la propose à ce compte.
 * Le classId retourné est celui de la liste serveur : la même clé que via le sélecteur, donc la
 * reprise du brouillon SQLite existant (jamais une seconde session pour la même classe et date).
 */
export function matchDirectRollCallTarget(
  selectedClass: { classId?: unknown; className?: unknown } | null | undefined,
  classes: readonly RollCallClassOption[],
): DirectRollCallTarget | null {
  const classId = canonicalRollCallClassId(selectedClass?.classId);
  if (!classId) return null;
  const option = classes.find((entry) => entry.classId === classId);
  if (!option) return null;
  return { classId: option.classId, className: option.className || String(selectedClass?.className ?? "") || "Classe" };
}

/** Réservé aux tests : vide la mémoire des listes. */
export function resetRollCallClassListsForTests() {
  lastLists.clear();
}
