type Row = Record<string, unknown>;

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function normalizeClassName(value: unknown) {
  return normalize(String(value ?? ""));
}

export function classNamesMatch(left: unknown, right: unknown): boolean {
  return normalizeClassName(left) === normalizeClassName(right);
}

/**
 * Projection lecture : filtre établissement.
 * Les mutations Classes passent par l'écran Classes → POST/PATCH /api/classes. Pas de CRUD legacy.
 */
export function filterSchoolClassRecords(classes: Row[], schoolCode?: string) {
  if (!schoolCode || schoolCode === "*") return classes;
  return classes.filter((row) => normalize(row.schoolCode) === normalize(schoolCode));
}
