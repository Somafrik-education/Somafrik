/**
 * Synchronisation compte utilisateur (rôle Enseignant) → fiche teachers[].
 * Lot 1 — miroir fonctionnel Web/backend (V2.1) :
 * - Canon TEACHERS-*
 * - AC-HIST-02 : twin TEACHER-* seul sans auto-upgrade
 * - Multi-twins : no-op + skip tracé (jamais twins[0])
 * - Multi-canon : TEACHER_CANON_AMBIGUOUS (blocage)
 */

import type { UserAccount } from "../data/catalog";

type Row = Record<string, unknown>;

export type TeacherIdentitySkip = {
  code: string;
  userId: string;
  schoolCode: string;
  twinIds?: string[];
  teacherIds?: string[];
  action: "noop";
  message: string;
};

export type TeacherIdentityError = Error & { code: string; statusCode: number };

function normalize(value?: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
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

/** Identifiant canonique pour toute NOUVELLE fiche enseignant Mobile. */
export function createTeacherRecordId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `TEACHERS-${crypto.randomUUID()}`;
  }
  return `TEACHERS-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function syncError(code: string, message: string, statusCode = 409): TeacherIdentityError {
  const error = new Error(message) as TeacherIdentityError;
  error.code = code;
  error.statusCode = statusCode;
  return error;
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

function uniqueByTeacherId(rows: Row[] = []): Row[] {
  const byId = new Map<string, Row>();
  for (const teacher of rows) {
    const id = String(teacher.id ?? "").trim();
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, teacher);
  }
  return [...byId.values()];
}

/**
 * Canon TEACHERS-* : userId + établissement, puis affectation active unique.
 * Ambiguïté → TEACHER_CANON_AMBIGUOUS.
 */
export function resolveCanonicalTeachersRow(
  teachers: Row[],
  user: UserAccount,
  schoolCode: string,
  assignments: Row[] = [],
): Row | null {
  const candidates = uniqueByTeacherId(teachersCodeLinked(teachers, user, schoolCode));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;

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

  const viaAssignment = candidates.filter((teacher) =>
    activeTeacherIds.has(String(teacher.id ?? "").trim()),
  );
  if (viaAssignment.length === 1) return viaAssignment[0] ?? null;

  throw syncError(
    "TEACHER_CANON_AMBIGUOUS",
    "Plusieurs identités pédagogiques TEACHERS-* pour ce compte ; impossible de choisir un canon sans ambiguïté",
  );
}

function nextTeacherLoginId(schoolCode: string, teachers: Row[]) {
  const normalizedSchool = schoolCode.trim().toUpperCase();
  let max = 0;
  for (const teacher of teachers) {
    if (
      normalizedSchool &&
      teacher.schoolCode &&
      normalize(String(teacher.schoolCode)) !== normalize(normalizedSchool)
    ) {
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

/**
 * Lot 1 : ne pas aggraver le réveil d'Inactif/archived (matrice complète = Lot 3).
 */
function resolveSyncedStatus(user: UserAccount, existing?: Row): string {
  const archived = existing?.archived === true;
  const existingStatus = normalize(String(existing?.status ?? ""));
  if (
    archived ||
    existingStatus === "archived" ||
    existingStatus === "inactif" ||
    existingStatus === "inactive"
  ) {
    return String(existing?.status ?? "Inactif");
  }
  return user.status === "Suspendu" ? "Suspendu" : "Actif";
}

function buildTeacherRow(user: UserAccount, existing?: Row, forceNewTeachersId = false): Row {
  const schoolCode = String(user.schoolCode ?? "").trim();
  const ids = existing?.identifier
    ? { identifier: String(existing.identifier), publicId: String(existing.publicId ?? "") }
    : nextTeacherLoginId(schoolCode, []);

  let id: string;
  if (existing?.id && !forceNewTeachersId) {
    id = String(existing.id);
  } else {
    id = createTeacherRecordId();
    if (!isTeachersCode(id)) {
      throw syncError("TEACHER_CANON_REQUIRED", "Nouvelle fiche enseignant doit être TEACHERS-*");
    }
  }

  return {
    ...(existing ?? {}),
    id,
    userId: user.id,
    publicId: String(user.publicId ?? ids.publicId),
    identifier: String(user.identifier ?? ids.identifier),
    schoolCode,
    name: String(user.lastName ?? existing?.name ?? "Enseignant").trim(),
    firstName: String(user.firstName ?? existing?.firstName ?? "").trim(),
    gender: user.gender ?? existing?.gender ?? "Non renseigné",
    phone: user.phone ?? existing?.phone ?? "",
    email: user.email ?? existing?.email ?? "",
    status: resolveSyncedStatus(user, existing),
    password: user.temporaryPassword ?? existing?.password ?? "",
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

function recordSkip(skips: TeacherIdentitySkip[] | undefined, entry: TeacherIdentitySkip) {
  if (Array.isArray(skips)) skips.push(entry);
}

/**
 * Crée ou met à jour la fiche enseignant liée à un compte.
 * @throws TeacherIdentityError TEACHER_CANON_AMBIGUOUS
 */
export function upsertTeacherFromUser(
  teachers: Row[],
  user: UserAccount,
  options: { assignments?: Row[]; skips?: TeacherIdentitySkip[] } = {},
): Row[] {
  if (!isTeacherUserRole(user.role)) {
    return teachers;
  }
  const schoolCode = String(user.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") {
    return teachers;
  }

  const assignments = options.assignments ?? [];
  const skips = options.skips;
  const canon = resolveCanonicalTeachersRow(teachers, user, schoolCode, assignments);

  if (canon) {
    return replaceTeacher(teachers, canon.id, buildTeacherRow(user, canon));
  }

  // AC-HIST-02 : historique TEACHER-* seul
  if (twinOnlyLinked(teachers, user, schoolCode)) {
    const twins = uniqueByTeacherId(
      teachersLinkedByUserId(teachers, user, schoolCode).filter((teacher) =>
        isTeacherTwinCode(teacher.id),
      ),
    );
    if (twins.length === 1 && twins[0]) {
      return replaceTeacher(teachers, twins[0].id, buildTeacherRow(user, twins[0]));
    }
    recordSkip(skips, {
      code: "TEACHER_HISTORICAL_MULTI_TWIN",
      userId: String(user.id ?? ""),
      schoolCode,
      twinIds: twins.map((teacher) => String(teacher.id)),
      action: "noop",
      message:
        "Plusieurs fiches historiques TEACHER-* pour ce compte : aucune mutation automatique (pas de choix arbitraire).",
    });
    return teachers;
  }

  const linked = uniqueByTeacherId(teachersLinkedByUserId(teachers, user, schoolCode));
  if (linked.length === 0) {
    const row = buildTeacherRow(user, undefined, true);
    return [row, ...teachers];
  }
  if (linked.length === 1 && linked[0]) {
    return replaceTeacher(teachers, linked[0].id, buildTeacherRow(user, linked[0]));
  }

  recordSkip(skips, {
    code: "TEACHER_LINK_AMBIGUOUS",
    userId: String(user.id ?? ""),
    schoolCode,
    teacherIds: linked.map((teacher) => String(teacher.id)),
    action: "noop",
    message: "Plusieurs fiches liées non départageables : aucune mutation automatique.",
  });
  return teachers;
}

export {
  isTeachersCode,
  isTeacherTwinCode,
  syncError,
};
