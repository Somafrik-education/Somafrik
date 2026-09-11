/**
 * Contrat UX Mobile — progressive disclosure (Lot 0, GO CTO 2026-09-11).
 * Logique pure, testable hors device. Importé par les tests, pas par les écrans.
 *
 * Source narrative : docs/ux/progressive-disclosure-mobile.md
 */

export const PD_UX_SPEC_VERSION = "1.0";

/** Option A : le CTA principal Notes reste visible carte fermée. */
export const PD_EVALUATION_PRIMARY_CTA_WHEN_COLLAPSED = true;

/** Les quatre choix d’appel restent actionnables sans déplier. */
export const PD_ROLL_CALL_STATUSES_ALWAYS_VISIBLE = true;

/** Messages = fil + fenêtre, pas une carte dépliable. */
export const PD_MESSAGES_USE_THREAD_MODAL = true;

/** Écrans historiques : ne pas réenregistrer dans le graphe live. */
export const PD_DEAD_SCREENS = [
  "AdminCrudScreen",
  "MenuScreen",
  "PlatformNotificationsScreen",
] as const;

/**
 * Cible liste évaluations (amendement PED-L3-12, lot Évaluations — pas ce lot).
 * Progression visible fermée ; date / coefficient / enseignant en zone ouverte.
 */
export const PD_EVALUATION_COLLAPSED_REQUIRES_PROGRESS = true;
export const PD_EVALUATION_COLLAPSED_OMITS = ["coefficient", "teacherName", "date"] as const;
export const PD_EVALUATION_SECONDARY_ACTIONS = ["Modifier", "Valider", "Publier"] as const;

export const PD_RED_EXPECTED_IDS = [
  "PD-01",
  "PD-02",
  "PD-03",
  "PD-04",
  "PD-06",
  "PD-07",
] as const;

export type PdRedId = (typeof PD_RED_EXPECTED_IDS)[number];
