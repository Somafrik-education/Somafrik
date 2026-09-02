import type { BackOfficeState } from "../types";
import { parsePeriodDate } from "./academicPeriods";
import { normalize } from "./format";
import { getTeacherDisplayName } from "./pedagogySync";

type Row = Record<string, unknown>;

const TEACHER_MIN_ENTRY_AGE_YEARS = 18;

function startOfCalendarDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Un enseignant ne peut entrer dans l'établissement qu'à partir de ses 18 ans. */
export function validateTeacherSchoolEntry(teacher: Row): string | null {
  const entryDate = String(teacher.entryDate ?? "").trim();
  if (!entryDate) return null;

  const birthDate = String(teacher.birthDate ?? "").trim();
  if (!birthDate) {
    return "La date de naissance est requise pour enregistrer une date d'entrée.";
  }

  const birth = parsePeriodDate(birthDate);
  const entry = parsePeriodDate(entryDate);
  if (!birth || !entry) return null;

  if (startOfCalendarDay(entry).getTime() < startOfCalendarDay(birth).getTime()) {
    return "La date d'entrée ne peut pas être antérieure à la date de naissance.";
  }

  const minEntry = new Date(
    birth.getFullYear() + TEACHER_MIN_ENTRY_AGE_YEARS,
    birth.getMonth(),
    birth.getDate(),
  );
  if (startOfCalendarDay(entry).getTime() < startOfCalendarDay(minEntry).getTime()) {
    return "Un enseignant doit avoir au moins 18 ans à la date d'entrée dans l'établissement.";
  }

  return null;
}

/** Empêche la création répétée d'une même identité civile dans un établissement. */
export function validateTeacherIdentityDuplicate(
  candidate: Row,
  teachers: Row[],
  excludedId?: string,
): string | null {
  const normalizedPersonName = (value: unknown) =>
    normalize(String(value ?? "")).replace(/\s+/g, " ");
  const schoolCode = normalize(String(candidate.schoolCode ?? ""));
  const name = normalizedPersonName(candidate.name);
  const firstName = normalizedPersonName(candidate.firstName);
  const birthDate = String(candidate.birthDate ?? "").trim();
  if (!schoolCode || !name || !firstName) return null;

  const duplicate = teachers.find((teacher) => {
    if (excludedId && String(teacher.id ?? "") === excludedId) return false;
    if (
      normalize(String(teacher.schoolCode ?? "")) !== schoolCode ||
      normalizedPersonName(teacher.name) !== name ||
      normalizedPersonName(teacher.firstName) !== firstName
    ) {
      return false;
    }
    const existingBirthDate = String(teacher.birthDate ?? "").trim();
    return !birthDate || !existingBirthDate || birthDate === existingBirthDate;
  });

  return duplicate
    ? "Une fiche enseignant portant les mêmes nom et prénom existe déjà dans cet établissement. Modifiez la fiche existante ou renseignez des dates de naissance différentes s'il s'agit d'homonymes."
    : null;
}

export interface TeacherDeletionBlocker {
  kind: string;
  label: string;
  detail: string;
}

function teacherNameKeys(teacher: Row): Set<string> {
  const display = normalize(getTeacherDisplayName(teacher));
  const name = normalize(teacher.name);
  const firstName = normalize(teacher.firstName);
  const keys = new Set<string>();
  if (display) keys.add(display);
  if (name) keys.add(name);
  if (firstName) keys.add(firstName);
  if (firstName && name) keys.add(`${firstName} ${name}`.trim());
  return keys;
}

function rowReferencesTeacher(row: Row, teacherId: string, nameKeys: Set<string>): boolean {
  if (teacherId && String(row.teacherId ?? "") === teacherId) return true;
  const rowName = normalize(String(row.teacherName ?? ""));
  return Boolean(rowName && nameKeys.has(rowName));
}

/** Détecte les enregistrements qui empêchent la suppression d'une fiche enseignant. */
export function analyzeTeacherDeletion(
  state: BackOfficeState,
  teacher: Row,
): TeacherDeletionBlocker[] {
  const teacherId = String(teacher.id ?? "").trim();
  const nameKeys = teacherNameKeys(teacher);
  const blockers: TeacherDeletionBlocker[] = [];

  const assignments = ((state.assignments ?? []) as Row[]).filter((row) =>
    rowReferencesTeacher(row, teacherId, nameKeys),
  );
  for (const row of assignments.slice(0, 4)) {
    blockers.push({
      kind: "assignment",
      label: "Affectation",
      detail: `${String(row.subject ?? row.course ?? "Cours")} — ${String(row.className ?? "—")}`,
    });
  }
  if (assignments.length > 4) {
    blockers.push({
      kind: "assignment",
      label: "Affectation",
      detail: `${assignments.length - 4} autre(s) affectation(s)`,
    });
  }

  const courses = ((state.courses ?? []) as Row[]).filter((row) =>
    rowReferencesTeacher(row, teacherId, nameKeys),
  );
  for (const row of courses.slice(0, 3)) {
    blockers.push({
      kind: "course",
      label: "Cours",
      detail: `${String(row.name ?? row.subject ?? "Cours")} — ${String(row.className ?? "—")}`,
    });
  }
  if (courses.length > 3) {
    blockers.push({
      kind: "course",
      label: "Cours",
      detail: `${courses.length - 3} autre(s) cours`,
    });
  }

  const schedules = ((state.courseSchedules ?? []) as Row[]).filter((row) =>
    rowReferencesTeacher(row, teacherId, nameKeys),
  );
  if (schedules.length) {
    blockers.push({
      kind: "schedule",
      label: "Planning",
      detail: `${schedules.length} séance(s) d'emploi du temps`,
    });
  }

  const classes = ((state.classes ?? []) as Row[]).filter(
    (row) => teacherId && String(row.teacherId ?? "") === teacherId,
  );
  for (const row of classes.slice(0, 3)) {
    blockers.push({
      kind: "class",
      label: "Classe",
      detail: `Responsable de ${String(row.name ?? row.className ?? "—")}`,
    });
  }

  const linkedUsers = ((state.users ?? []) as unknown as Row[]).filter((user) => {
    if (teacherId && String(teacher.userId ?? "") === String(user.id ?? "")) return true;
    if (teacherId && String(user.id ?? "") === String(teacher.userId ?? "")) return true;
    const teacherIdentifier = normalize(teacher.identifier);
    const userIdentifier = normalize(user.identifier);
    return Boolean(teacherIdentifier && userIdentifier && teacherIdentifier === userIdentifier);
  });
  for (const user of linkedUsers) {
    blockers.push({
      kind: "user",
      label: "Compte utilisateur",
      detail: `${String(user.identifier ?? user.id ?? "—")} (${String(user.role ?? "—")})`,
    });
  }

  const linkedContacts = ((state.contacts ?? []) as unknown as Row[]).filter((contact) => {
    if (teacherId && String(contact.teacherId ?? "") === teacherId) return true;
    if (normalize(String(contact.contactType ?? "")) !== "enseignant") return false;
    const last = normalize(contact.lastName);
    const first = normalize(contact.firstName);
    return nameKeys.has(`${first} ${last}`.trim()) || nameKeys.has(last);
  });
  for (const contact of linkedContacts.slice(0, 2)) {
    blockers.push({
      kind: "contact",
      label: "Contact CRM",
      detail: `${String(contact.firstName ?? "")} ${String(contact.lastName ?? "")}`.trim(),
    });
  }
  if (linkedContacts.length > 2) {
    blockers.push({
      kind: "contact",
      label: "Contact CRM",
      detail: `${linkedContacts.length - 2} autre(s) contact(s)`,
    });
  }

  return blockers;
}

export function formatTeacherDeletionMessage(teacher: Row, blockers: TeacherDeletionBlocker[]): string {
  const label = getTeacherDisplayName(teacher);
  const lines = blockers.map((item) => `• ${item.label} : ${item.detail}`);
  return [
    `Suppression impossible pour ${label} :`,
    ...lines,
    "Retirez ou réaffectez ces éléments avant de supprimer l'enseignant.",
  ].join("\n");
}

export function validateTeacherDeletion(
  state: BackOfficeState,
  teacher: Row,
): string | null {
  const blockers = analyzeTeacherDeletion(state, teacher);
  if (!blockers.length) return null;
  return formatTeacherDeletionMessage(teacher, blockers);
}
