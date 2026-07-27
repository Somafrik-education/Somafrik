import type { BackOfficeState, UserAccount } from "../types";
import { normalize } from "./format";
import { resolveTeacherIdentifiers } from "./entityIdentifiers";

type Row = Record<string, unknown>;

function newTeacherId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `TEACHERS-${crypto.randomUUID()}`;
  }
  return `TEACHERS-${Date.now()}`;
}

function isTeachersCode(id?: unknown): boolean {
  return /^TEACHERS-/i.test(String(id ?? "").trim());
}

function isTeacherTwinCode(id?: unknown): boolean {
  const s = String(id ?? "").trim();
  return /^TEACHER-/i.test(s) && !/^TEACHERS-/i.test(s);
}

function sameSchool(teacherSchool: unknown, schoolCode: string): boolean {
  return normalize(String(teacherSchool ?? "")) === normalize(schoolCode);
}

export function isTeacherUserRole(role?: string): boolean {
  const key = normalize(role ?? "");
  return key === "enseignant" || key === "teacher" || key.includes("prof");
}

function teachersLinkedByUserId(teachers: Row[], user: UserAccount, schoolCode: string): Row[] {
  const userId = String(user.id ?? "").trim();
  if (!userId) return [];
  return teachers.filter(
    (teacher) =>
      String(teacher.userId ?? "").trim() === userId && sameSchool(teacher.schoolCode, schoolCode),
  );
}

function teachersCodeLinked(teachers: Row[], user: UserAccount, schoolCode: string): Row[] {
  return teachersLinkedByUserId(teachers, user, schoolCode).filter((teacher) =>
    isTeachersCode(teacher.id),
  );
}

function twinOnlyLinked(teachers: Row[], user: UserAccount, schoolCode: string): boolean {
  const linked = teachersLinkedByUserId(teachers, user, schoolCode);
  if (!linked.length) return false;
  const hasTeachers = linked.some((teacher) => isTeachersCode(teacher.id));
  const hasTwin = linked.some((teacher) => isTeacherTwinCode(teacher.id));
  return hasTwin && !hasTeachers;
}

/**
 * Canon TEACHERS-* : userId + établissement, puis affectation active unique.
 * Ambiguïté → erreur structurée (pas de created_at / premier élément).
 */
export function resolveCanonicalTeachersRow(
  teachers: Row[],
  user: UserAccount,
  schoolCode: string,
  assignments: Row[] = [],
): Row | null {
  const candidates = teachersCodeLinked(teachers, user, schoolCode);
  // Même id répété dans le tableau ≠ pluralité d'identités
  const byId = new Map<string, Row>();
  for (const teacher of candidates) {
    const id = String(teacher.id ?? "").trim();
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, teacher);
  }
  const unique = [...byId.values()];
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0] ?? null;

  const activeTeacherIds = new Set(
    assignments
      .filter((assignment) => {
        if (!sameSchool(assignment.schoolCode, schoolCode)) return false;
        const status = normalize(String(assignment.status ?? "active"));
        return status === "" || status === "active" || status === "actif";
      })
      .map((assignment) => String(assignment.teacherId ?? "").trim())
      .filter(Boolean),
  );

  const viaAssignment = unique.filter((teacher) =>
    activeTeacherIds.has(String(teacher.id ?? "").trim()),
  );
  if (viaAssignment.length === 1) return viaAssignment[0] ?? null;

  const error = new Error(
    "Plusieurs identités pédagogiques TEACHERS-* pour ce compte ; impossible de choisir un canon sans ambiguïté",
  ) as Error & { code?: string; statusCode?: number };
  error.code = "TEACHER_CANON_AMBIGUOUS";
  error.statusCode = 409;
  throw error;
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
  const contactId = String(user.contactId ?? existing?.contactId ?? "").trim();

  return {
    ...(existing ?? {}),
    id: String(existing?.id ?? newTeacherId()),
    userId: user.id,
    contactId: contactId || undefined,
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

function replaceTeacher(teachers: Row[], previousId: unknown, row: Row): Row[] {
  const next = [...teachers];
  const index = next.findIndex((teacher) => String(teacher.id) === String(previousId));
  if (index >= 0) {
    next[index] = row;
    return next;
  }
  return [row, ...next];
}

/** Crée ou met à jour la fiche enseignant liée à un compte utilisateur. */
export function upsertTeacherFromUser(
  teachers: Row[],
  user: UserAccount,
  options: { assignments?: Row[] } = {},
): Row[] {
  if (!isTeacherUserRole(user.role)) {
    return teachers;
  }

  const schoolCode = String(user.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") {
    return teachers;
  }

  const assignments = options.assignments ?? [];
  const canon = resolveCanonicalTeachersRow(teachers, user, schoolCode, assignments);

  if (canon) {
    return replaceTeacher(teachers, canon.id, buildTeacherRow(user, canon));
  }

  // AC-HIST-02 / §4.1.c : historique TEACHER-* seul
  if (twinOnlyLinked(teachers, user, schoolCode)) {
    const twinsById = new Map<string, Row>();
    for (const teacher of teachersLinkedByUserId(teachers, user, schoolCode)) {
      if (!isTeacherTwinCode(teacher.id)) continue;
      const id = String(teacher.id ?? "").trim();
      if (id && !twinsById.has(id)) twinsById.set(id, teacher);
    }
    const twins = [...twinsById.values()];
    if (twins.length === 1 && twins[0]) {
      return replaceTeacher(teachers, twins[0].id, buildTeacherRow(user, twins[0]));
    }
    // Plusieurs TEACHER-* : no-op (pas de twins[0])
    return teachers;
  }

  const linkedById = new Map<string, Row>();
  for (const teacher of teachersLinkedByUserId(teachers, user, schoolCode)) {
    const id = String(teacher.id ?? "").trim();
    if (id && !linkedById.has(id)) linkedById.set(id, teacher);
  }
  const linked = [...linkedById.values()];
  if (linked.length === 0) {
    return [buildTeacherRow(user), ...teachers];
  }
  if (linked.length === 1 && linked[0]) {
    return replaceTeacher(teachers, linked[0].id, buildTeacherRow(user, linked[0]));
  }
  // Plusieurs fiches liées non départageables → no-op
  return teachers;
}

/** Synchronise toutes les fiches enseignants à partir des comptes utilisateurs. */
export function syncTeachersFromUserAccounts(state: BackOfficeState): Row[] {
  let teachers = [...((state.teachers ?? []) as Row[])];
  const assignments = (state.assignments ?? []) as Row[];
  for (const user of state.users ?? []) {
    if (!isTeacherUserRole(user.role)) continue;
    // Côté client : strict — TEACHER_CANON_AMBIGUOUS n'est pas absorbée
    teachers = upsertTeacherFromUser(teachers, user, { assignments });
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
    teachers: upsertTeacherFromUser((state.teachers ?? []) as Row[], user, {
      assignments: (state.assignments ?? []) as Row[],
    }),
  };
}

function teacherLinkedToUser(teachers: Row[], user: UserAccount): boolean {
  const userId = normalize(String(user.id ?? ""));
  const identifier = normalize(String(user.identifier ?? ""));
  return teachers.some((teacher) => {
    if (userId && normalize(String(teacher.userId ?? "")) === userId) return true;
    if (identifier && normalize(String(teacher.identifier ?? "")) === identifier) return true;
    return false;
  });
}

/** Comptes enseignant sans fiche opérationnelle (Comptes utilisateurs → Enseignants). */
export function getLinkableTeacherUserOptions(
  state: BackOfficeState,
  schoolCode: string,
): { value: string; label: string }[] {
  const school = normalize(schoolCode);
  const teachers = (state.teachers ?? []) as Row[];
  return (state.users ?? [])
    .filter((user) => {
      if (!isTeacherUserRole(user.role)) return false;
      const userSchool = normalize(String(user.schoolCode ?? ""));
      if (school && school !== "*" && userSchool && userSchool !== school) return false;
      return !teacherLinkedToUser(teachers, user);
    })
    .map((user) => ({
      value: String(user.id ?? ""),
      label:
        `${String(user.firstName ?? "")} ${String(user.lastName ?? "")}`.trim() ||
        String(user.identifier ?? user.id ?? ""),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

export interface TeacherProvisioningOption {
  value: string;
  label: string;
  kind: "contact" | "user";
}

/** Contacts ou comptes utilisateurs éligibles à la création d'une fiche enseignant. */
export function getTeacherProvisioningOptions(
  state: BackOfficeState,
  schoolCode: string,
  contactOptions: { value: string; label: string }[],
): TeacherProvisioningOption[] {
  const fromContacts = contactOptions.map((option) => ({
    ...option,
    value: `contact:${option.value}`,
    kind: "contact" as const,
  }));
  const fromUsers = getLinkableTeacherUserOptions(state, schoolCode).map((option) => ({
    ...option,
    value: `user:${option.value}`,
    kind: "user" as const,
  }));
  return [...fromContacts, ...fromUsers].sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

export function parseTeacherProvisioningSelection(
  value: string,
): { kind: "contact" | "user"; id: string } | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  const match = /^(contact|user):(.+)$/i.exec(normalized);
  if (match?.[1] && match?.[2]) {
    return { kind: match[1].toLowerCase() as "contact" | "user", id: match[2] };
  }
  return { kind: "contact", id: normalized };
}

/** Propage les champs dossier enseignant vers le compte utilisateur lié. */
export function syncTeacherProfileToUser(users: UserAccount[], teacher: Row): UserAccount[] {
  const userId = String(teacher.userId ?? "").trim();
  if (!userId) return users;
  const lastName = String(teacher.name ?? "").trim();
  const firstName = String(teacher.firstName ?? "").trim();
  return users.map((user) => {
    if (String(user.id ?? "") !== userId) return user;
    return {
      ...user,
      firstName: firstName || user.firstName,
      lastName: lastName || user.lastName,
      phone: String(teacher.phone ?? user.phone ?? ""),
      email: String(teacher.email ?? user.email ?? ""),
      birthDate: String(teacher.birthDate ?? user.birthDate ?? ""),
      gender: String(teacher.gender ?? user.gender ?? "Non renseigné"),
      publicId: String(teacher.publicId ?? user.publicId ?? ""),
    };
  });
}
