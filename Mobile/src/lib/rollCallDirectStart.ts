/**
 * PRES-LOCAL-NAV-01 — « Démarrer l'appel NFC/QR » depuis une classe DÉJÀ ouverte sur l'écran
 * Présences : l'appel local s'ouvre directement sur cette classe, sans seconde sélection.
 *
 * Aucune autorisation nouvelle : la classe ouverte n'est retenue que si elle figure dans la liste
 * serveur des classes ouvertes à l'appel pour CE compte (même contrat que le sélecteur, le pack et
 * la synchronisation : GET …/roll-call/offline/v1/classes). Sinon — classe absente, liste
 * indisponible sans copie du compte, identifiant non canonique — le sélecteur habituel s'ouvre.
 *
 * Hors connexion : dernière liste obtenue pour CE compte et CET établissement (mémoire du
 * processus, jamais persistée), partagée avec le sélecteur. Le serveur revérifie tout à la sync.
 */
import type { RollCallClassOption } from "../services/rollCallOfflineApi";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Dernière liste par compte + établissement (jamais partagée entre comptes). */
const lastLists = new Map<string, RollCallClassOption[]>();

export type RollCallClassList = { classes: RollCallClassOption[]; cached: boolean };

/**
 * Liste des classes ouvertes à l'appel : réseau d'abord, puis dernière liste du MÊME compte.
 * Rejette si aucune des deux n'est disponible.
 */
export async function loadRollCallClasses(
  scopeKey: string,
  fetchClasses: () => Promise<{ classes: RollCallClassOption[] }>,
): Promise<RollCallClassList> {
  try {
    const result = await fetchClasses();
    if (scopeKey) lastLists.set(scopeKey, result.classes);
    return { classes: result.classes, cached: false };
  } catch (error) {
    const cached = scopeKey ? lastLists.get(scopeKey) : undefined;
    if (cached) return { classes: cached, cached: true };
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
