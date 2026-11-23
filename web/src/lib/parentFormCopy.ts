/**
 * PARITE-WEB-MOBILE-RECOVERY-01 / LOT 3 — vocabulaire des formulaires Parent.
 * Miroir exact de `Mobile/src/lib/parentFormCopy.ts` (PARENT_FORM_COPY) : la parité est
 * vérifiée par `Mobile/src/lib/parentFormParity.test.ts`. Libellés du formulaire de liaison : décision CTO PARITÉ-SAFE-02.
 */

export const PARENT_FORM_COPY = {
  sectionTitle: "Parents et responsables",
  linkAction: "Créer ou lier un parent",
  linkPending: "Liaison en cours…",
  firstName: "Prénom",
  lastName: "Nom",
  phone: "Téléphone",
  email: "E-mail",
  /**
   * Formulaire de liaison Parent (fiche Élève) : libellés explicites, décision CTO
   * définitive PARITÉ-SAFE-02 (23/11/2026). Ne pas raccourcir.
   */
  linkFirstName: "Prénom du parent",
  linkLastName: "Nom du parent",
  linkPhone: "Téléphone du parent",
  linkEmail: "E-mail du parent",
  principalBadge: "Principal",
  emptyList: "Aucun parent ou responsable lié",
  missingContact: "Renseignez un téléphone ou un e-mail pour identifier le parent.",
  notProvided: "Non renseigné",
  /** Champs parent dans les formulaires d'inscription / modification d'un élève (contexte élève). */
  enrollmentPhone: "Téléphone du parent",
  enrollmentEmail: "E-mail du parent",
} as const;
