/**
 * Vérité Scolarité L0 — copie alignée sur web/src/lib/schoolingTruth.ts.
 * PostgreSQL via GET /classes, GET /students, GET /v2/academic-years.
 */
export const SYNTHETIC_CLASS_ID_PREFIX = "CLASS-";

export const SCOLARITE_COPY = {
  title: "Scolarité",
  loading: "Chargement de la scolarité…",
  emptyClasses: "Aucune classe n'est encore créée pour cet établissement.",
  emptyStudents: "Aucun élève inscrit. Ouvrez une classe puis « Inscrire un élève ».",
  missingYear: "Aucune année scolaire active",
  enrollments: "Inscriptions",
  enrollmentsHint: "Pour inscrire un élève, ouvrez une classe puis « Inscrire un élève ».",
  indicators: "Indicateurs",
  actions: "Actions",
  administration: "Administration de l'établissement",
  openClassStudents: "Voir les élèves",
  openStudentFiche: "Ouvrir la fiche",
  openHubAction: "Ouvrir",
} as const;

type ClassLike = {
  id?: unknown;
  classCode?: unknown;
  publicId?: unknown;
  name?: unknown;
  className?: unknown;
  groupCode?: unknown;
};

type YearLike = {
  isCurrent?: boolean;
  status?: string;
  name?: string;
};

export function isCanonicalClassRecord(row: ClassLike | null | undefined): boolean {
  if (!row || typeof row !== "object") return false;
  const id = String(row.id ?? "").trim();
  const classCode = String(row.classCode ?? "").trim();
  const publicId = String(row.publicId ?? "").trim();
  if (id.startsWith(SYNTHETIC_CLASS_ID_PREFIX)) return false;
  if (!classCode && publicId.startsWith(SYNTHETIC_CLASS_ID_PREFIX)) return false;
  return Boolean(id || classCode || (publicId && !publicId.startsWith(SYNTHETIC_CLASS_ID_PREFIX)));
}

export function filterCanonicalClasses<T extends ClassLike>(rows: readonly T[] | null | undefined): T[] {
  return (rows ?? []).filter((row) => isCanonicalClassRecord(row));
}

export function countCanonicalClasses(rows: readonly ClassLike[] | null | undefined): number {
  return filterCanonicalClasses(rows).length;
}

export function selectCurrentAcademicYear<T extends YearLike>(years: readonly T[] | null | undefined): T | null {
  const list = years ?? [];
  const flagged = list.find((year) => year.isCurrent === true);
  if (flagged) return flagged;
  const byStatus = list.find((year) => {
    const status = String(year.status ?? "")
      .trim()
      .toLowerCase();
    return status === "current" || status === "active" || status === "en_cours" || status === "en cours";
  });
  return byStatus ?? null;
}

export function studentHasAssignedClass(student: {
  classCode?: unknown;
  className?: unknown;
  classId?: unknown;
}): boolean {
  return Boolean(
    String(student.classCode ?? "").trim() ||
      String(student.className ?? "").trim() ||
      String(student.classId ?? "").trim(),
  );
}

export function countStudentsWithoutClass(
  students: readonly { classCode?: unknown; className?: unknown; classId?: unknown }[] | null | undefined,
): number {
  return (students ?? []).filter((student) => !studentHasAssignedClass(student)).length;
}

export function isPedagogicalSeriesCode(value: unknown): boolean {
  return /^[A-Z]$/i.test(String(value ?? "").trim());
}

function pedagogicalSeriesToken(groupCode?: string | null, groupName?: string | null): string {
  const code = String(groupCode ?? "").trim();
  if (isPedagogicalSeriesCode(code)) return code.toLocaleUpperCase("fr");
  const name = String(groupName ?? "").trim();
  if (isPedagogicalSeriesCode(name)) return name.toLocaleUpperCase("fr");
  return "";
}

export function composeClassPreviewName(parts: {
  levelName?: string | null;
  streamName?: string | null;
  groupCode?: string | null;
  groupName?: string | null;
}): string {
  return [
    String(parts.levelName ?? "").trim(),
    String(parts.streamName ?? "").trim(),
    pedagogicalSeriesToken(parts.groupCode, parts.groupName),
  ]
    .filter(Boolean)
    .join(" ");
}

export function getClassDisplayName(row: Pick<ClassLike, "name" | "className" | "groupCode">): string {
  const name = String(row.name ?? row.className ?? "").trim();
  const groupCode = String(row.groupCode ?? "").trim();
  if (!name || !groupCode) return name;
  if (isPedagogicalSeriesCode(groupCode)) return name;
  const suffix = ` ${groupCode}`;
  return name.toLocaleLowerCase("fr").endsWith(suffix.toLocaleLowerCase("fr"))
    ? name.slice(0, -suffix.length).trim()
    : name;
}
