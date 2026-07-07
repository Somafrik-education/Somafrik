import type { UserAccount } from "../data/catalog";

type Row = Record<string, unknown>;

function normalize(value?: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function newTeacherId(): string {
  return `TEACHER-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function nextTeacherLoginId(schoolCode: string, teachers: Row[]) {
  const normalizedSchool = schoolCode.trim().toUpperCase();
  let max = 0;
  for (const teacher of teachers) {
    if (teacher.schoolCode && normalize(String(teacher.schoolCode)) !== normalize(normalizedSchool)) {
      continue;
    }
    for (const candidate of [teacher.publicId, teacher.identifier, teacher.id]) {
      const match = String(candidate ?? "").match(/ENS-(\d+)$/i);
      if (match?.[1]) {
        max = Math.max(max, Number(match[1]));
      }
    }
  }
  const sequence = max + 1;
  const identifier = `ENS-${String(sequence).padStart(4, "0")}`;
  return {
    identifier,
    publicId: normalizedSchool ? `${normalizedSchool}-${identifier}` : identifier,
  };
}

function buildTeacherRow(user: UserAccount, existing?: Row): Row {
  const schoolCode = String(user.schoolCode ?? "").trim();
  const ids = existing?.identifier
    ? { identifier: String(existing.identifier), publicId: String(existing.publicId ?? "") }
    : nextTeacherLoginId(schoolCode, []);

  return {
    ...(existing ?? {}),
    id: String(existing?.id ?? newTeacherId()),
    userId: user.id,
    publicId: String(user.publicId ?? ids.publicId),
    identifier: String(user.identifier ?? ids.identifier),
    schoolCode,
    name: String(user.lastName ?? existing?.name ?? "Enseignant").trim(),
    firstName: String(user.firstName ?? existing?.firstName ?? "").trim(),
    gender: user.gender ?? existing?.gender ?? "Non renseigné",
    phone: user.phone ?? existing?.phone ?? "",
    email: user.email ?? existing?.email ?? "",
    status: user.status === "Suspendu" ? "Suspendu" : "Actif",
    password: user.temporaryPassword ?? existing?.password ?? "",
    assignments: Array.isArray(existing?.assignments) ? existing.assignments : [],
    assignedClasses: Array.isArray(existing?.assignedClasses) ? existing.assignedClasses : [],
  };
}

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
