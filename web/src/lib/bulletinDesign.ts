import type { BackOfficeState } from "../types";
import { getSchoolAcademicLists, getSubjectsForClass } from "./academicConfig";
import { scopedClasses, scopedCourses } from "./establishment";
import { normalize } from "./format";
import type { SessionUser } from "../types";

export interface BulletinClassDesign {
  className: string;
  reportTitle: string;
  reportSubtitle?: string;
  periodLabel: string;
  enabledSubjects: string[];
  showRank: boolean;
  showAppreciation: boolean;
  showQrCode: boolean;
  footerNote: string;
  /** HTML exporté GrapesJS (corps ou document complet). */
  htmlTemplate?: string;
  /** CSS exporté GrapesJS. */
  cssTemplate?: string;
  /** Projet GrapesJS pour ré-édition. */
  grapesProject?: Record<string, unknown>;
  templateVersion?: number;
}

export function defaultBulletinClassDesign(className: string, subjects: string[]): BulletinClassDesign {
  return {
    className,
    reportTitle: `Bulletin scolaire — ${className}`,
    reportSubtitle: "Année académique en cours · Somafrik",
    periodLabel: "Trimestre 1",
    enabledSubjects: [...subjects],
    showRank: true,
    showAppreciation: true,
    showQrCode: true,
    footerNote: "Document généré par Somafrik.",
    templateVersion: 1,
  };
}

export function readBulletinDesignByClass(
  academicConfig: Record<string, unknown>,
  className: string,
  subjects: string[],
): BulletinClassDesign {
  const stored = academicConfig.bulletinDesignByClass;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return defaultBulletinClassDesign(className, subjects);
  }
  const row = (stored as Record<string, unknown>)[className];
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return defaultBulletinClassDesign(className, subjects);
  }
  const design = row as Partial<BulletinClassDesign>;
  const enabledSubjects = Array.isArray(design.enabledSubjects)
    ? design.enabledSubjects.filter((item): item is string => typeof item === "string")
    : subjects;
  return {
    ...defaultBulletinClassDesign(className, subjects),
    ...design,
    className,
    enabledSubjects: enabledSubjects.length ? enabledSubjects : [...subjects],
  };
}

export function listClassNamesForSchool(
  user: SessionUser | null,
  state: BackOfficeState,
  schoolCode: string,
): string[] {
  const scopedUser = user ? { ...user, schoolCode } : null;
  const fromClasses = scopedClasses(scopedUser, state)
    .map((row) => String(row.name ?? "").trim())
    .filter(Boolean);
  const fromStudents = (state.students ?? [])
    .filter((row) => normalize((row as { schoolCode?: string }).schoolCode) === normalize(schoolCode))
    .map((row) => String((row as { className?: string }).className ?? "").trim())
    .filter(Boolean);
  const fromConfig = getSchoolAcademicLists(state, schoolCode).classNames;
  return [...new Set([...fromConfig, ...fromClasses, ...fromStudents])].sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
}

export function listSubjectsForClass(
  state: BackOfficeState,
  schoolCode: string,
  className: string,
  user: SessionUser | null,
): string[] {
  const fromConfig = getSubjectsForClass(state, schoolCode, className);
  const scopedUser = user ? { ...user, schoolCode } : null;
  const fromCourses = scopedCourses(scopedUser, state)
    .filter((row) => normalize(String(row.className ?? "")) === normalize(className))
    .map((row) => String(row.name ?? row.subject ?? "").trim())
    .filter(Boolean);
  return [...new Set([...fromConfig, ...fromCourses])].sort((a, b) => a.localeCompare(b, "fr"));
}
