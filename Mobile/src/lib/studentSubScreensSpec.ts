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
