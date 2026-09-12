/**
 * Copie et formatage — professeur principal d'une classe.
 * Aligné web/src/lib/classHeadTeacher.ts.
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

export function classPatchKey(row: { classCode?: string | null; publicId?: string | null; id?: string | null }): string {
  return String(row.classCode || row.publicId || row.id || "").trim();
}

export function applyHeadTeacherClassPatch<T extends Record<string, unknown>>(
  previous: T,
  updated: Record<string, unknown>,
): T {
  const headTeacher = (updated.headTeacher as HeadTeacherRef | null | undefined) ?? null;
  const headTeacherCode = String(
    updated.headTeacherCode ?? headTeacher?.teacherCode ?? "",
  ).trim();
  const displayName =
    classHeadTeacherDisplayName({
      headTeacherDisplayName: updated.headTeacherDisplayName as string | null | undefined,
      headTeacher,
      teacher: updated.teacher as string | null | undefined,
    }) || "";
  return {
    ...previous,
    teacherId: headTeacherCode,
    teacher: displayName || HEAD_TEACHER_COPY.unassigned,
    headTeacher,
    headTeacherCode: headTeacherCode || null,
    headTeacherDisplayName: displayName || null,
  };
}

/** Après un reload canonique, la liste distante reprend autorité : les patches des classes présentes sont retirés. */
export function reconcileHeadTeacherPatches<T extends Record<string, unknown>>(
  patches: Record<string, T>,
  classes: Array<{ classCode?: string | null; publicId?: string | null; id?: string | null }>,
): Record<string, T> {
  if (!patches || Object.keys(patches).length === 0) return patches;
  const loadedKeys = new Set(
    classes.map((row) => classPatchKey(row)).filter(Boolean),
  );
  const next: Record<string, T> = {};
  for (const [key, patch] of Object.entries(patches)) {
    if (!loadedKeys.has(key)) {
      next[key] = patch;
    }
  }
  return next;
}
