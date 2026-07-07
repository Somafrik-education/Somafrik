import type { BackOfficeState } from "../types";
import { normalize } from "./format";
import { getTeacherDisplayName } from "./pedagogySync";

type Row = Record<string, unknown>;

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
      detail: `${String(row.subject ?? row.course ?? "Matière")} — ${String(row.className ?? "—")}`,
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
      label: "Matière",
      detail: `${String(row.name ?? row.subject ?? "Matière")} — ${String(row.className ?? "—")}`,
    });
  }
  if (courses.length > 3) {
    blockers.push({
      kind: "course",
      label: "Matière",
      detail: `${courses.length - 3} autre(s) matière(s)`,
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
