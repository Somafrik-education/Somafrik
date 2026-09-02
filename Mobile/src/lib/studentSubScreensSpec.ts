/**
 * Contrat UI/UX — sous-écrans fiche élève (Notes, Présences, Paiements).
 */

export const STUDENT_SUB_SCREENS_COPY = {
  notesTitle: "Notes",
  presencesTitle: "Présences",
  paymentsTitle: "Paiements",
  paymentsSectionTitle: "Historique détaillé",
  notesEmpty: "Aucune note disponible",
  presencesEmpty: "Aucune présence enregistrée",
  paymentsEmpty: "Aucun paiement enregistré",
} as const;

export const STUDENT_SUB_SCREENS_TEST_IDS = {
  notesScreen: "student-notes-screen",
  notesTitle: "student-notes-title",
  notesList: "student-notes-list",
  notesEmpty: "student-notes-empty",
  noteRowPrefix: "student-note-row-",
  presencesScreen: "student-presences-screen",
  presencesTitle: "student-presences-title",
  presencesList: "student-presences-list",
  presencesEmpty: "student-presences-empty",
  presenceRowPrefix: "student-presence-row-",
  paymentsScreen: "student-payments-screen",
  paymentsTitle: "student-payments-title",
  paymentsList: "student-payments-list",
  paymentsEmpty: "student-payments-empty",
  paymentsKpiHero: "student-payments-kpi-hero",
  paymentsKpiGrid: "student-payments-kpi-grid",
  paymentsHistoryTitle: "student-payments-history-title",
  paymentRowPrefix: "student-payment-row-",
  subScreenBackButton: "student-subscreen-back-button",
  openNotesButton: "student-detail-open-notes",
  openPresencesButton: "student-detail-open-presences",
  openPaymentsButton: "student-detail-open-payments",
} as const;

export const NOTE_ROW_TEST_ID = (noteId: string) =>
  `${STUDENT_SUB_SCREENS_TEST_IDS.noteRowPrefix}${noteId}`;

export const PRESENCE_ROW_TEST_ID = (presenceId: string) =>
  `${STUDENT_SUB_SCREENS_TEST_IDS.presenceRowPrefix}${presenceId}`;

export const PAYMENT_ROW_TEST_ID = (paymentId: string) =>
  `${STUDENT_SUB_SCREENS_TEST_IDS.paymentRowPrefix}${paymentId}`;

/** Espacement minimum entre lignes de liste (px). */
export const MIN_LIST_ROW_GAP = 10;

/**
 * Densité KPI — écran Paiements élève (Option A : hero compact + mini-cards 2×2).
 * Layout uniquement : ne change pas Imputé / Reste à payer / Encaissé / Non imputé.
 */
export const STUDENT_PAYMENTS_KPI_DENSITY = {
  heroPaddingVertical: 8,
  heroPaddingHorizontal: 12,
  heroLabelFontSize: 12,
  heroValueFontSize: 20,
  heroValueMarginTop: 2,
  heroMarginBottom: 8,
  kpiPaddingVertical: 6,
  kpiPaddingHorizontal: 10,
  kpiLabelFontSize: 12,
  kpiValueFontSize: 14,
  kpiValueMarginTop: 2,
  kpiGap: 8,
  kpiBlockMarginBottom: 8,
} as const;

/** Hauteur estimée du bloc KPI (hero + grille 2×2), hors header / CTA. */
export function estimateStudentPaymentsKpiStackHeight(
  density: {
    heroPaddingVertical: number;
    heroLabelFontSize: number;
    heroValueFontSize: number;
    heroValueMarginTop: number;
    heroMarginBottom: number;
    kpiPaddingVertical: number;
    kpiLabelFontSize: number;
    kpiValueFontSize: number;
    kpiValueMarginTop: number;
    kpiGap: number;
    kpiBlockMarginBottom: number;
  } = STUDENT_PAYMENTS_KPI_DENSITY,
): number {
  const hero =
    density.heroPaddingVertical * 2 +
    density.heroLabelFontSize +
    density.heroValueMarginTop +
    density.heroValueFontSize +
    density.heroMarginBottom;
  const kpiCard =
    density.kpiPaddingVertical * 2 +
    density.kpiLabelFontSize +
    density.kpiValueMarginTop +
    density.kpiValueFontSize;
  const grid = kpiCard * 2 + density.kpiGap + density.kpiBlockMarginBottom;
  return hero + grid;
}
