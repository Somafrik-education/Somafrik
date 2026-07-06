import { normalize } from "./format";
import type { BackOfficeState } from "../types";

type Row = Record<string, unknown>;

export function normalizeClassName(value: unknown) {
  return normalize(String(value ?? ""));
}

function scopedSchoolStudents(state: BackOfficeState, schoolCode?: string): Row[] {
  const rows = (state.students ?? []) as Row[];
  if (!schoolCode || schoolCode === "*") return rows;
  return rows.filter((row) => normalize(row.schoolCode) === normalize(schoolCode));
}

function classBelongsToSchool(item: Row, schoolCode: string | undefined, className: string): boolean {
  const target = normalizeClassName(className);
  if (normalizeClassName(item.name) !== target) return false;
  if (!schoolCode || schoolCode === "*") return true;
  const itemSchool = normalize(item.schoolCode ?? "");
  return !itemSchool || itemSchool === normalize(schoolCode);
}

export function validateClassDeletion(
  className: string,
  state: BackOfficeState,
  schoolCode?: string,
): string | null {
  const target = normalizeClassName(className);
  if (!target) return "Le nom de la classe est requis.";

  const students = scopedSchoolStudents(state, schoolCode);
  const enrolled = students.filter((student) => normalizeClassName(student.className) === target);
  if (enrolled.length) {
    return `Suppression refusée : ${enrolled.length} élève(s) encore inscrit(s) dans cette classe.`;
  }

  const courses = ((state.courses ?? []) as Row[]).filter((course) =>
    normalizeClassName(course.className) === target,
  );
  if (courses.length) {
    return `Suppression refusée : ${courses.length} cours lié(s) à cette classe. Retirez-les d'abord.`;
  }

  const courseSchedules = ((state.courseSchedules ?? []) as Row[]).filter((slot) =>
    normalizeClassName(slot.className) === target,
  );
  if (courseSchedules.length) {
    return `Suppression refusée : ${courseSchedules.length} créneau(x) planning lié(s) à cette classe. Retirez-les dans Planning de cours.`;
  }

  return null;
}

export function removeSchoolClassFromState(
  state: BackOfficeState,
  row: Row,
  schoolCode?: string,
): { ok: true; patch: Partial<BackOfficeState> } | { ok: false; error: string } {
  const className = String(row.name ?? "").trim();
  const error = validateClassDeletion(className, state, schoolCode);
  if (error) return { ok: false, error };

  const nextClasses = ((state.classes ?? []) as Row[]).filter(
    (item) => !classBelongsToSchool(item, schoolCode, className),
  );

  if (nextClasses.length === ((state.classes ?? []) as Row[]).length) {
    const target = normalizeClassName(className);
    const hasSyntheticOnly =
      String(row.id ?? "").startsWith("CLASS-") ||
      normalizeClassName(String(row.id ?? "").replace(/^CLASS-/i, "")) === target;
    if (hasSyntheticOnly) {
      return {
        ok: false,
        error:
          "Suppression refusée : cette classe n'existe que via des inscriptions élèves ou la configuration. Retirez d'abord les élèves ou modifiez la liste dans Configuration.",
      };
    }
    return { ok: false, error: "Suppression refusée : classe introuvable dans le périmètre établissement." };
  }

  const patch: Partial<BackOfficeState> = { classes: nextClasses };

  if (schoolCode && schoolCode !== "*") {
    const currentConfig = { ...((state.academicConfigs?.[schoolCode] ?? {}) as Record<string, unknown>) };
    if (Array.isArray(currentConfig.classNames)) {
      currentConfig.classNames = (currentConfig.classNames as string[]).filter(
        (name) => normalizeClassName(name) !== normalizeClassName(className),
      );
    }
    patch.academicConfigs = {
      ...state.academicConfigs,
      [schoolCode]: currentConfig,
    };
  }

  return { ok: true, patch };
}

export function findClassByName(classes: Row[], name: string, excludeId?: string) {
  const target = normalizeClassName(name);
  if (!target) return undefined;
  return classes.find(
    (row) =>
      normalizeClassName(row.name) === target &&
      String(row.id ?? "") !== String(excludeId ?? ""),
  );
}

export function validateUniqueClassName(
  name: string,
  classes: Row[],
  excludeId?: string,
): string | null {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return "Le nom de classe est requis.";
  if (findClassByName(classes, trimmed, excludeId)) {
    return `La classe « ${trimmed} » existe déjà dans l'établissement.`;
  }
  return null;
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

export function getAvailableClassNameOptions(
  configuredNames: string[],
  existingClasses: Row[],
  currentName?: string,
) {
  const taken = new Set(
    existingClasses.map((row) => normalizeClassName(row.name)).filter(Boolean),
  );
  const current = normalizeClassName(currentName);
  if (current) taken.delete(current);

  const options: string[] = [];
  const seen = new Set<string>();
  for (const name of configuredNames) {
    const key = normalizeClassName(name);
    if (!key || seen.has(key)) continue;
    if (taken.has(key) && key !== current) continue;
    seen.add(key);
    options.push(name.trim());
  }
  if (current && !seen.has(current) && String(currentName ?? "").trim()) {
    options.push(String(currentName).trim());
  }
  return options.sort((a, b) => a.localeCompare(b, "fr"));
}

export function filterSchoolClassRecords(classes: Row[], schoolCode?: string) {
  if (!schoolCode || schoolCode === "*") return classes;
  return classes.filter((row) => normalize(row.schoolCode) === normalize(schoolCode));
}
