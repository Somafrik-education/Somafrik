/**
 * Copie et formatage — professeur principal d'une classe.
 * Aligné Mobile/src/lib/classHeadTeacher.ts.
 */

export const HEAD_TEACHER_COPY = {
  unassigned: "Non assigné",
  linePrefix: "Professeur principal :",
  assign: "Affecter un professeur principal",
  modify: "Modifier l'affectation",
  confirm: "Confirmer l'affectation",
  cancel: "Annuler",
  remove: "Retirer l'affectation",
  search: "Rechercher un enseignant",
  empty: "Aucun enseignant actif dans cet établissement.",
  modalTitleAssign: "Affecter un professeur principal",
  modalTitleModify: "Modifier l'affectation",
  removeTitle: "Retirer l'affectation ?",
  removeDescription: "Cette classe n'aura plus de professeur principal.",
  successAssign: "Professeur principal affecté.",
  successReplace: "Affectation du professeur principal mise à jour.",
  successRemove: "Affectation du professeur principal retirée.",
  errorNetwork: "Affectation impossible. L'état précédent a été conservé.",
  alreadyHint: (classes: string) => `Déjà professeur principal de ${classes}`,
} as const;

export function formatHeadTeacherDisplayName(firstName?: string | null, lastName?: string | null): string {
  const first = String(firstName ?? "").trim();
  const last = String(lastName ?? "").trim();
  const lastDisplay = last ? last.toLocaleUpperCase("fr") : "";
  return [first, lastDisplay].filter(Boolean).join(" ");
}

export function formatHeadTeacherLine(displayName?: string | null): string {
  const name = String(displayName ?? "").trim();
  return `${HEAD_TEACHER_COPY.linePrefix} ${name || HEAD_TEACHER_COPY.unassigned}`;
}

export function isActiveClass(status?: string | null): boolean {
  return String(status ?? "active").trim().toLowerCase() === "active";
}

export type HeadTeacherRef = {
  teacherCode?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
};

function meaningfulHeadTeacherName(value?: string | null): string {
  const name = String(value ?? "").trim();
  if (!name || name === HEAD_TEACHER_COPY.unassigned || name === "Non assigne") return "";
  return name;
}

export function classHeadTeacherDisplayName(row: {
  headTeacherDisplayName?: string | null;
  headTeacher?: HeadTeacherRef | null;
  teacher?: string | null;
  teacherId?: string | null;
}): string {
  const fromDto = meaningfulHeadTeacherName(row.headTeacherDisplayName ?? row.headTeacher?.displayName);
  if (fromDto) return fromDto;
  const composed = formatHeadTeacherDisplayName(row.headTeacher?.firstName, row.headTeacher?.lastName);
  if (composed) return composed;
  return meaningfulHeadTeacherName(row.teacher);
}

export function classHasHeadTeacher(row: {
  headTeacherDisplayName?: string | null;
  headTeacher?: HeadTeacherRef | null;
  teacherId?: string | null;
  headTeacherCode?: string | null;
  teacher?: string | null;
}): boolean {
  return Boolean(
    String(row.headTeacherCode ?? "").trim() ||
      String(row.headTeacher?.teacherCode ?? "").trim() ||
      classHeadTeacherDisplayName(row),
  );
}
