/**
 * Contrat UX textuel L0/L1 — maquette Admin établissement + spec Mobile V2.
 * Pas de parité pixel. Importé uniquement par les tests rouges / docs.
 *
 * Source narrative : docs/audits/parite-l0-l1-ux-maquette.md
 */
export const MAQUETTE_L0_L1_VIEWPORTS_DP = [360, 390, 430] as const;
export const MAQUETTE_MIN_TOUCH_DP = 44;
export const MAQUETTE_MAX_HOME_KPIS = 4;
export const MAQUETTE_KPI_A11Y_ROLE = "button";

/** Libellés qui marquent une entrée comme non opérationnelle (#577 L0 option C). */
export const NON_OPERATIONAL_LABEL_RE =
  /non op[ée]rationnel|non.op[ée]rationnel|indisponible|bientôt|placeholder|coming\s*soon|lecture seule volontaire/i;
