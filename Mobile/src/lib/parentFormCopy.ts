/**
 * PARITE-WEB-MOBILE-RECOVERY-01 / LOT 3 — vocabulaire et règles des formulaires Parent.
 * Miroir exact de `web/src/lib/parentFormCopy.ts` : la parité est vérifiée par
 * `parentFormParity.test.ts`. Libellés du formulaire de liaison : décision CTO PARITÉ-SAFE-02.
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

export type ParentLinkDraft = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
};

/** Même règle que le Web : un téléphone OU un e-mail identifie le parent. */
export function validateParentLinkDraft(draft: Pick<ParentLinkDraft, "phone" | "email">): string | null {
  if (!String(draft.phone ?? "").trim() && !String(draft.email ?? "").trim()) {
    return PARENT_FORM_COPY.missingContact;
  }
  return null;
}

/** Charge utile `POST /parents/link` identique au Web (champs vides omis pour le nom). */
export function buildParentLinkPayload(studentId: string, draft: ParentLinkDraft) {
  const firstName = String(draft.firstName ?? "").trim();
  const lastName = String(draft.lastName ?? "").trim();
  return {
    studentId,
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    phone: String(draft.phone ?? "").trim(),
    email: String(draft.email ?? "").trim(),
  };
}

/** Responsable principal : même lecture que le Web (`activeLinkedParents`). */
export function isPrincipalRelation(row: { isPrincipal?: unknown } | null | undefined): boolean {
  const value = row?.isPrincipal;
  return value === true || String(value ?? "").trim().toLowerCase() === "oui";
}

/** Principal en tête, comme sur le Web. */
export function sortRelationsPrincipalFirst<T extends { isPrincipal?: unknown }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Number(isPrincipalRelation(b)) - Number(isPrincipalRelation(a)));
}
