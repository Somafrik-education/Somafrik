/**
 * APPEL-NAV-01 — « Démarrer l'appel NFC/QR » depuis une classe DÉJÀ ouverte : pas de seconde
 * sélection de classe. La classe ouverte n'est retenue que si elle figure dans la liste des
 * classes ouvertes à l'appel renvoyée par le serveur pour ce compte (même source et même
 * périmètre que le sélecteur : classes affectées pour un enseignant, établissement pour un rôle
 * autorisé). Sinon → sélecteur. Le serveur revérifie tout au pack et à la synchronisation.
 *
 * Liaison à l'identité (revue CTO #1161) : chaque chargement est lié à la clé
 * `environnement|établissement|utilisateur` capturée au départ. Toute réponse (réseau ou cache)
 * qui revient alors que la clé courante a changé est rejetée sans effet : rien n'est ouvert,
 * rien n'est mis en cache, même si l'identifiant de classe est identique.
 *
 * Module pur, sans dépendance (fetch et identité injectés) : aucune donnée d'élève, aucune écriture.
 */
export type RollCallClassRef = { classId: string; className: string };
export type RollCallClassListItem = { classId: string; className: string };
export type RollCallClassList<T extends RollCallClassListItem = RollCallClassListItem> = { classes: T[]; cached: boolean };

/** Erreur d'une réponse arrivée sous une identité qui n'est plus la courante : à ignorer. */
export const ROLL_CALL_STALE_SCOPE = "RC_CLASSES_STALE_SCOPE";

export function isStaleRollCallScope(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === ROLL_CALL_STALE_SCOPE;
}

function staleScope(): Error {
  return Object.assign(new Error(ROLL_CALL_STALE_SCOPE), { code: ROLL_CALL_STALE_SCOPE });
}

export function findAuthorizedRollCallClass(
  authorized: ReadonlyArray<RollCallClassListItem>,
  openedClassId: unknown,
): RollCallClassRef | null {
  const wanted = String(openedClassId ?? "").trim().toLowerCase();
  if (!wanted) return null;
  const match = authorized.find((option) => String(option?.classId ?? "").trim().toLowerCase() === wanted);
  if (!match) return null;
  // Identifiant et libellé du serveur : même cible que si la classe avait été choisie au sélecteur.
  return { classId: match.classId, className: match.className };
}

/**
 * Chargeur de la liste des classes, lié à l'identité :
 * - refuse de partir si la clé demandée n'est pas la clé courante ;
 * - au retour, rejette la réponse (succès ou échec) si la clé courante a changé : pas de cache,
 *   pas de résultat ;
 * - requêtes concurrentes d'une même clé : seule la plus récente met le cache à jour, une
 *   réponse plus ancienne arrivée après ne l'écrase pas ;
 * - hors connexion : dernière liste de CETTE clé uniquement (mémoire du processus).
 */
export function createScopedRollCallClassLoader<T extends RollCallClassListItem>(fetchClasses: () => Promise<{ classes: T[] }>) {
  const lastLists = new Map<string, T[]>();
  const latestRequest = new Map<string, number>();
  let sequence = 0;

  async function load(scopeKey: string, currentScope: () => string): Promise<RollCallClassList<T>> {
    // Clé vide (identité non résolue) : lecture serveur seule, jamais de cache (comportement d'avant).
    if (currentScope() !== scopeKey) throw staleScope();
    const request = ++sequence;
    latestRequest.set(scopeKey, request);
    let classes: T[];
    try {
      classes = (await fetchClasses()).classes;
    } catch (error) {
      if (currentScope() !== scopeKey) throw staleScope();
      const cached = scopeKey ? lastLists.get(scopeKey) : undefined;
      if (cached) return { classes: cached, cached: true };
      throw error;
    }
    if (currentScope() !== scopeKey) throw staleScope();
    if (scopeKey && latestRequest.get(scopeKey) === request) lastLists.set(scopeKey, classes);
    return { classes, cached: false };
  }

  return {
    load,
    /** Lecture du cache (tests / diagnostic) — jamais d'une autre clé. */
    cachedFor: (scopeKey: string): T[] | undefined => (scopeKey ? lastLists.get(scopeKey) : undefined),
  };
}

/**
 * Ouverture directe depuis une classe ouverte. Capture classe ET identité au départ ; au retour,
 * n'agit que si les deux sont inchangées. Un seul chargement à la fois (double appui ignoré),
 * rien si un appel est déjà affiché.
 *   - pas de classe ouverte ou identité non résolue → sélecteur (comportement d'avant)
 *   - classe dans la liste du compte → ouverture directe
 *   - hors liste / liste indisponible → sélecteur
 *   - classe ou identité changée     → rien
 */
export type DirectRollCallOpenerDeps = {
  load: (scopeKey: string, currentScope: () => string) => Promise<{ classes: RollCallClassListItem[] }>;
  currentScope: () => string;
  currentClassId: () => string;
  isRollCallOpen: () => boolean;
  onOpen: (target: RollCallClassRef) => void;
  onPicker: () => void;
};

export function createDirectRollCallOpener(deps: DirectRollCallOpenerDeps) {
  let inFlight = false;

  function start(): Promise<void> {
    const openedClassId = deps.currentClassId();
    if (!openedClassId) {
      deps.onPicker();
      return Promise.resolve();
    }
    if (inFlight || deps.isRollCallOpen()) return Promise.resolve();
    const scopeKey = deps.currentScope();
    // Identité non résolue : pas d'ouverture directe, sélecteur comme avant.
    if (!scopeKey) {
      deps.onPicker();
      return Promise.resolve();
    }
    inFlight = true;
    const stillCurrent = () => deps.currentScope() === scopeKey && deps.currentClassId() === openedClassId;
    return deps
      .load(scopeKey, deps.currentScope)
      .then(
        ({ classes }) => ({ stale: false, target: findAuthorizedRollCallClass(classes, openedClassId) }),
        (error: unknown) => ({ stale: isStaleRollCallScope(error), target: null as RollCallClassRef | null }),
      )
      .then(({ stale, target }) => {
        if (stale || !stillCurrent() || deps.isRollCallOpen()) return;
        if (target) deps.onOpen(target);
        else deps.onPicker();
      })
      .finally(() => {
        inFlight = false;
      });
  }

  return { start, isLoading: () => inFlight };
}
