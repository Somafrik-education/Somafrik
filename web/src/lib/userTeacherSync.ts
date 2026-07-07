import type { BackOfficeState, UserAccount } from "../types";
import { normalize } from "./format";
import { resolveTeacherIdentifiers } from "./entityIdentifiers";

type Row = Record<string, unknown>;

function newTeacherId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `TEACHER-${crypto.randomUUID()}`;
  }
  return `TEACHER-${Date.now()}`;
}

export function isTeacherUserRole(role?: string): boolean {
  const key = normalize(role ?? "");
  return key === "enseignant" || key === "teacher" || key.includes("prof");
}

function teacherMatchesUser(teacher: Row, user: UserAccount): boolean {
  if (user.id && String(teacher.userId ?? "") === String(user.id)) {
    return true;
  }
  if (teacher.userId && String(teacher.userId) !== String(user.id ?? "")) {
    return false;
  }
  const userIdentifier = normalize(String(user.identifier ?? ""));
  const teacherIdentifier = normalize(String(teacher.identifier ?? ""));
  return Boolean(userIdentifier && userIdentifier === teacherIdentifier);
}

function buildTeacherRow(user: UserAccount, existing?: Row): Row {
  const schoolCode = String(user.schoolCode ?? "").trim();
  const teachersForIds = existing ? [existing] : [];
  const ids = resolveTeacherIdentifiers(
    {
      publicId: user.publicId,
      identifier: user.identifier,
    },
    schoolCode,
    teachersForIds,
  );

  const lastName = String(user.lastName ?? "").trim();
  const firstName = String(user.firstName ?? "").trim();

  return {
    ...(existing ?? {}),
    id: String(existing?.id ?? newTeacherId()),
    userId: user.id,
    publicId: String(user.publicId ?? ids.publicId),
    identifier: String(user.identifier ?? ids.identifier),
    schoolCode,
    name: lastName || String(existing?.name ?? "Enseignant"),
    firstName: firstName || String(existing?.firstName ?? ""),
    gender: user.gender ?? existing?.gender ?? "Non renseigné",
    phone: user.phone ?? existing?.phone ?? "",
    email: user.email ?? existing?.email ?? "",
    birthDate: user.birthDate ?? existing?.birthDate ?? "",
    status: user.status === "Suspendu" ? "Suspendu" : "Actif",
    password: user.temporaryPassword ?? user.password ?? existing?.password ?? "",
    assignments: Array.isArray(existing?.assignments) ? existing.assignments : [],
    assignedClasses: Array.isArray(existing?.assignedClasses) ? existing.assignedClasses : [],
  };
}

/** Crée ou met à jour la fiche enseignant liée à un compte utilisateur. */
export function upsertTeacherFromUser(teachers: Row[], user: UserAccount): Row[] {
  if (!isTeacherUserRole(user.role)) {
    return teachers;
  }

  const schoolCode = String(user.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") {
    return teachers;
  }

  const next = [...teachers];
  const index = next.findIndex((teacher) => teacherMatchesUser(teacher, user));
  const row = buildTeacherRow(user, index >= 0 ? next[index] : undefined);

  if (index >= 0) {
    next[index] = row;
    return next;
  }

  return [row, ...next];
}

/** Synchronise toutes les fiches enseignants à partir des comptes utilisateurs. */
export function syncTeachersFromUserAccounts(state: BackOfficeState): Row[] {
  let teachers = [...((state.teachers ?? []) as Row[])];
  for (const user of state.users ?? []) {
    if (!isTeacherUserRole(user.role)) continue;
    teachers = upsertTeacherFromUser(teachers, user);
  }
  return teachers;
}

/** Patch backoffice après création / modification d'utilisateurs. */
export function applyUserTeacherSync(state: BackOfficeState): Pick<BackOfficeState, "teachers"> {
  return { teachers: syncTeachersFromUserAccounts(state) };
}

/** Synchronise la fiche enseignant pour un seul compte (création ou édition). */
export function syncSingleUserToTeachers(
  state: BackOfficeState,
  user: UserAccount,
): Pick<BackOfficeState, "teachers"> {
  if (!isTeacherUserRole(user.role)) {
    return { teachers: (state.teachers ?? []) as Row[] };
  }
  return {
    teachers: upsertTeacherFromUser((state.teachers ?? []) as Row[], user),
  };
}
