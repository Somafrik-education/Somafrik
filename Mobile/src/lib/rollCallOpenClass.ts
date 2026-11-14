/**
 * APPEL-NAV-01 — « Démarrer l'appel NFC/QR » depuis une classe DÉJÀ ouverte : pas de seconde
 * sélection de classe. La classe ouverte n'est retenue que si elle figure dans la liste des
 * classes ouvertes à l'appel renvoyée par le serveur pour ce compte (même source et même
 * périmètre que le sélecteur : classes affectées pour un enseignant, établissement pour un rôle
 * autorisé). Sinon → `null`, et l'écran retombe sur le sélecteur. Le serveur revérifie tout au
 * pack et à la synchronisation.
 *
 * Module pur, sans dépendance : aucune donnée d'élève, aucune écriture.
 */
export type RollCallClassRef = { classId: string; className: string };

export function findAuthorizedRollCallClass(
  authorized: ReadonlyArray<{ classId: string; className: string }>,
  openedClassId: unknown,
): RollCallClassRef | null {
  const wanted = String(openedClassId ?? "").trim().toLowerCase();
  if (!wanted) return null;
  const match = authorized.find((option) => String(option?.classId ?? "").trim().toLowerCase() === wanted);
  if (!match) return null;
  // Identifiant et libellé du serveur : même cible que si la classe avait été choisie au sélecteur.
  return { classId: match.classId, className: match.className };
}
