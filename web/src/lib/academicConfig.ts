import type { BackOfficeState } from "../types";

export const DEFAULT_LEVELS = ["1ère", "2ème", "3ème", "4ème", "5ème", "6ème"];
export const DEFAULT_TRACKS = ["Générale", "Sciences", "Lettres", "Technique", "Commerciale"];
export const DEFAULT_CLASS_NAMES = DEFAULT_LEVELS.flatMap((level) => [`${level} A`, `${level} B`]);
export const DEFAULT_SUBJECTS = [
  "Mathématiques",
  "Français",
  "Sciences",
  "Histoire",
  "Géographie",
  "Anglais",
  "Physique",
  "Chimie",
  "SVT",
  "Informatique",
];

/** Rôles proposés à la création de comptes utilisateurs (personnalisables par établissement). */
export const DEFAULT_USER_ROLES = [
  "Secrétaire",
  "Préfet des études",
  "Enseignant",
  "Parent",
  "Élève / Étudiant",
  "Comptable",
  "Proviseur / Directeur",
];

export function parseListLines(value: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value.split(/\r?\n|,/)) {
    const item = raw.trim();
    if (!item) continue;
    const key = item.toLocaleLowerCase("fr");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/** Matières par classe (migration depuis l'ancienne liste globale `subjects`). */
export function resolveSubjectsByClass(
  config: Record<string, unknown>,
  classNames: string[],
): Record<string, string[]> {
  const stored = config.subjectsByClass;
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    const result: Record<string, string[]> = {};
    classNames.forEach((className) => {
      const list = (stored as Record<string, unknown>)[className];
      result[className] = Array.isArray(list) ? (list as string[]) : [];
    });
    Object.entries(stored as Record<string, string[]>).forEach(([className, list]) => {
      if (!result[className] && Array.isArray(list) && list.length) {
        result[className] = list;
      }
    });
    return result;
  }

  const flat = Array.isArray(config.subjects) ? (config.subjects as string[]) : [];
  const migrated: Record<string, string[]> = {};
  classNames.forEach((className) => {
    migrated[className] = [...flat];
  });
  return migrated;
}

export function getSubjectsForClass(
  state: Pick<BackOfficeState, "academicConfigs">,
  schoolCode: string | undefined,
  className: string,
): string[] {
  if (!className.trim()) return [];
  const config = (state.academicConfigs?.[schoolCode ?? ""] ?? {}) as Record<string, unknown>;
  const classNames =
    Array.isArray(config.classNames) && config.classNames.length
      ? (config.classNames as string[])
      : [];
  const byClass = resolveSubjectsByClass(config, classNames);
  return byClass[className] ?? (Array.isArray(config.subjects) ? (config.subjects as string[]) : []);
}

export function getAllSchoolSubjects(subjectsByClass: Record<string, string[]>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  Object.values(subjectsByClass).forEach((list) => {
    list.forEach((subject) => {
      const key = subject.toLocaleLowerCase("fr");
      if (seen.has(key)) return;
      seen.add(key);
      result.push(subject);
    });
  });
  return result.sort((a, b) => a.localeCompare(b, "fr"));
}

export function getSchoolAcademicLists(
  state: Pick<BackOfficeState, "academicConfigs">,
  schoolCode?: string,
) {
  const config = (state.academicConfigs?.[schoolCode ?? ""] ?? {}) as Record<string, unknown>;
  const levels =
    Array.isArray(config.levels) && config.levels.length
      ? (config.levels as string[])
      : DEFAULT_LEVELS;
  const tracks =
    Array.isArray(config.tracks) && config.tracks.length
      ? (config.tracks as string[])
      : DEFAULT_TRACKS;
  const classNames = Array.isArray(config.classNames) ? (config.classNames as string[]) : [];
  const subjectsByClass = resolveSubjectsByClass(config, classNames);
  const subjects =
    Array.isArray(config.subjects) && config.subjects.length
      ? (config.subjects as string[])
      : getAllSchoolSubjects(subjectsByClass);
  const userRoles =
    Array.isArray(config.userRoles) && config.userRoles.length
      ? (config.userRoles as string[])
      : DEFAULT_USER_ROLES;
  return { levels, tracks, classNames, subjects, subjectsByClass, userRoles };
}

export function mergeSelectOptions(configList: string[], extra: string[] = []) {
  return [...new Set([...configList, ...extra.filter(Boolean)])].sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
}
