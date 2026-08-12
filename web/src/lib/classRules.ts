import { normalize } from "./format";

type Row = Record<string, unknown>;

export function normalizeClassName(value: unknown) {
  return normalize(String(value ?? ""));
}

export function classNamesMatch(left: unknown, right: unknown): boolean {
  return normalizeClassName(left) === normalizeClassName(right);
}

function classRecordPriority(row: Row): number {
  let score = 0;
  const id = String(row.id ?? "");
  if (!id.startsWith("CLASS-")) score += 20;
  if (row.publicId) score += 10;
  if (row.level) score += 3;
  if (row.track) score += 3;
  if (row.teacherId) score += 2;
  return score;
}

/** Une seule ligne par nom de classe (priorité aux fiches complètes). */
export function dedupeClassesByName(rows: Row[]): Row[] {
  const best = new Map<string, Row>();
  for (const row of rows) {
    const key = normalizeClassName(row.name ?? row.className);
    if (!key) continue;
    const current = best.get(key);
    if (!current || classRecordPriority(row) > classRecordPriority(current)) {
      best.set(key, row);
    }
  }
  return [...best.values()].sort((a, b) =>
    String(a.name ?? "").localeCompare(String(b.name ?? ""), "fr"),
  );
}

/**
 * Projection lecture : filtre établissement.
 * Conservé pour les modules encore dépendants de state.classes (planning, notes, etc.).
 */
export function filterSchoolClassRecords(classes: Row[], schoolCode?: string) {
  if (!schoolCode || schoolCode === "*") return classes;
  return classes.filter((row) => normalize(row.schoolCode) === normalize(schoolCode));
}
