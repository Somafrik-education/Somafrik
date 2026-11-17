/**
 * NFC-PRES-LOCAL-PR3 — réexport pour l'entrée de recette native (App.rcNativeProof.tsx) : le
 * parcours exécuté sous Hermes est exactement celui de l'écran, sans copie de logique.
 */
export { closeOfflineRollCall, openOfflineRollCall, prepareOfflinePack, processCard } from "./offlineRollCall";
export { findLatestSession as findLatestSessionForProof } from "../store/repository";

import type { RcPlatformDeps } from "../store/database";

/**
 * NFC-HERMES-CLOCK-01 — instant figé des vecteurs PR0 (`2026-11-09T07:31:02Z`), déjà utilisé par le
 * parcours PR3. Les appels de preuve SQLCipher et PR3 sont datés du 2026-11-09 : leur échéance
 * locale (J+3) doit être évaluée avec la même horloge aux deux lancements, sinon la preuve expire
 * d'elle-même passé le 2026-11-12 et échoue quel que soit le code testé.
 */
export const RC_PROOF_VECTOR_NOW_MS = Date.parse("2026-11-09T07:31:02Z");

/**
 * Plateforme de RECETTE à horloge contrôlée. Seule l'horloge est remplacée : base SQLCipher, clés,
 * système de fichiers et `runPurge` (règle J+3) sont inchangés. Jamais utilisée par l'application.
 */
export function withProofClock<T extends RcPlatformDeps>(platform: T, nowMs: number): T {
  return { ...platform, nowMs: () => nowMs };
}
