import type { BackOfficeState, SessionUser, UserAccount } from "../types";
import { normalize, resolveCountryScopeFromSchool } from "./format";
import { resolveTeacherIdentifiers } from "./entityIdentifiers";
import {
  generateTemporaryPassword,
  generateUserIdentifier,
  getRoleDefaults,
} from "./userAccounts";
import { resolveEffectivePermissions } from "./permissions";

type Row = Record<string, unknown>;

const TEACHER_USER_ROLE = "Enseignant";

export interface TeacherPromotionResult {
  users: UserAccount[];
  teacher: Row;
  created: boolean;
  temporaryPassword?: string;
}

function newTeacherId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `TEACHER-${crypto.randomUUID()}`;
  }
  return `TEACHER-${Date.now()}`;
}

export function isTeacherUserRole(role?: string): boolean {
  const key = normalize(role ?? "");
  return key === "enseignant" || key.includes("prof");
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

/** Crée un compte utilisateur pour une fiche enseignant nouvellement créée. */
export function promoteTeacherToUser(
  teacher: Row,
  state: BackOfficeState,
  creator: SessionUser | null,
): TeacherPromotionResult | null {
  const schoolCode = String(teacher.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") return null;

  const users = [...(state.users ?? [])];
  const teacherUserId = String(teacher.userId ?? "").trim();
  const teacherIdentifier = normalize(String(teacher.identifier ?? ""));

  const existingIndex = users.findIndex((user) => {
    if (teacherUserId && String(user.id ?? "") === teacherUserId) return true;
    if (teacherIdentifier && normalize(String(user.identifier ?? "")) === teacherIdentifier) return true;
    return false;
  });

  if (existingIndex >= 0) {
    const linked = users[existingIndex];
    return {
      users,
      teacher: { ...teacher, userId: linked.id, identifier: linked.identifier ?? teacher.identifier },
      created: false,
    };
  }

  const temporaryPassword = generateTemporaryPassword();
  const role = TEACHER_USER_ROLE;
  const identifier = String(teacher.identifier ?? generateUserIdentifier(state.users, role));
  const defaults = getRoleDefaults(role, schoolCode);
  const school = state.schools.find((item) => normalize(item.code) === normalize(schoolCode));

  const nextUser: UserAccount = {
    id: `USR-${Date.now()}`,
    firstName: String(teacher.firstName ?? ""),
    lastName: String(teacher.name ?? teacher.lastName ?? ""),
    gender: String(teacher.gender ?? "Non renseigné"),
    phone: String(teacher.phone ?? ""),
    email: String(teacher.email ?? ""),
    birthDate: String(teacher.birthDate ?? ""),
    role,
    schoolCode: defaults.schoolCode || schoolCode,
    scopeLevel: defaults.scopeLevel,
    accessChannel: defaults.accessChannel,
    countryScope:
      creator?.countryScope ?? resolveCountryScopeFromSchool(school ?? {}, ""),
    identifier,
    publicId: String(teacher.publicId ?? identifier),
    status: "Actif",
    permissions: resolveEffectivePermissions(role, undefined, state.rolePermissions),
    temporaryPassword,
    hasTemporaryPassword: true,
    mustChangePassword: true,
    createdAt: new Date().toISOString(),
    createdBy: creator?.identifier ?? creator?.firstName ?? "Administrateur",
  };

  users.unshift(nextUser);
  return {
    users,
    teacher: {
      ...teacher,
      userId: nextUser.id,
      identifier,
      password: temporaryPassword,
    },
    created: true,
    temporaryPassword,
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
