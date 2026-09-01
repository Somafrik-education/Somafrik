import type { BackOfficeState, SessionUser, UserAccount } from "../types";
import { COUNTRY_ADMIN_ROLE, isSuperAdminRole } from "./orgHierarchy";
import {
  buildUserScopeTrace,
  isSchoolScopedRole,
  resolveSessionSchoolIdentity,
  sameSchoolId,
  type SchoolScopeErrorCode,
  type UserScopeTrace,
} from "./schoolCanonicalIdentity";

type StudentRow = Record<string, unknown> & {
  schoolId?: string;
  schoolCode?: string;
  schoolPublicCode?: string;
  className?: string;
};

export type StudentScopeTrace = Omit<UserScopeTrace, "kind"> & {
  kind: "students_scope_trace";
};

export type StudentScopeProjection = {
  students: StudentRow[];
  error: { code: SchoolScopeErrorCode; message: string } | null;
  received: number;
  kept: number;
  trace: StudentScopeTrace;
};

const STUDENT_SCOPE_MESSAGES: Record<SchoolScopeErrorCode, string> = {
  MISSING_CANONICAL_IDENTITY:
    "Périmètre établissement incomplet : l'identité canonique schoolId (UUID membership) est absente de la session. Les élèves ne sont pas affichés.",
  SCOPE_MISMATCH:
    "Incohérence de périmètre : l'API a renvoyé des élèves, mais aucun ne correspond à l'identité établissement canonique de la session.",
  SCOPE_LEAK:
    "Alerte sécurité : la réponse élèves contient un autre établissement. Ces élèves sont masqués.",
  INCOMPLETE_ROW_IDENTITY:
    "Incohérence de périmètre : des élèves n'ont pas l'identité canonique schoolId. Ces lignes sont masquées.",
};

function toStudentRows(state: Pick<BackOfficeState, "students"> | { students?: unknown[] }): StudentRow[] {
  return ((state.students ?? []) as StudentRow[]).filter((row) => row && typeof row === "object");
}

function emptyProjection(
  user: SessionUser | null,
  received: StudentRow[],
  error: StudentScopeProjection["error"],
): StudentScopeProjection {
  const usersShaped: UserScopeTrace = buildUserScopeTrace({
    role: user?.role,
    session: user,
    received: received.map((row) => ({
      schoolId: row.schoolId,
      schoolCode: String(row.schoolCode ?? ""),
      schoolPublicCode: String(row.schoolPublicCode ?? ""),
    })) as UserAccount[],
    kept: [],
    error: error?.code ?? null,
  });
  return {
    students: [],
    error,
    received: received.length,
    kept: 0,
    trace: { ...usersShaped, kind: "students_scope_trace" },
  };
}

function withStudents(
  user: SessionUser | null,
  received: StudentRow[],
  kept: StudentRow[],
  error: StudentScopeProjection["error"],
): StudentScopeProjection {
  const usersShaped: UserScopeTrace = buildUserScopeTrace({
    role: user?.role,
    session: user,
    received: received.map((row) => ({
      schoolId: row.schoolId,
      schoolCode: String(row.schoolCode ?? ""),
      schoolPublicCode: String(row.schoolPublicCode ?? ""),
    })) as UserAccount[],
    kept: kept.map((row) => ({
      schoolId: row.schoolId,
      schoolCode: String(row.schoolCode ?? ""),
      schoolPublicCode: String(row.schoolPublicCode ?? ""),
    })) as UserAccount[],
    error: error?.code ?? null,
  });
  return {
    students: kept,
    error,
    received: received.length,
    kept: kept.length,
    trace: { ...usersShaped, kind: "students_scope_trace" },
  };
}

/**
 * Filtre leftover JWT vs login_code — reproduisait le 0 de la tuile Vue d'ensemble.
 * Conservé uniquement pour les tests de preuve avant/après. Jamais utilisé en prod.
 */
export function legacyScopedStudentsBySchoolCode(
  user: Pick<SessionUser, "schoolCode"> | null,
  state: Pick<BackOfficeState, "students"> | { students?: unknown[] },
): StudentRow[] {
  const schoolCode = user?.schoolCode;
  const rows = toStudentRows(state);
  if (!schoolCode || schoolCode === "*") return rows;
  const expected = String(schoolCode).trim().toUpperCase();
  return rows.filter((row) => String(row.schoolCode ?? "").trim().toUpperCase() === expected);
}

export function studentMatchesSchoolIdentity(
  student: Pick<StudentRow, "schoolId">,
  schoolId: string,
): boolean {
  return sameSchoolId(student.schoolId, schoolId);
}

/**
 * Autorité tenant élèves : schoolId membership uniquement.
 * Interdit : leftover CC-YYYY-NNNN, publicCode, schoolCode V2, fallback permissif.
 */
export function projectScopedStudents(
  user: SessionUser | null,
  state: Pick<BackOfficeState, "students"> | { students?: unknown[] },
): StudentScopeProjection {
  const received = toStudentRows(state);
  if (!user) {
    return emptyProjection(null, received, null);
  }
  if (isSuperAdminRole(user.role)) {
    return withStudents(user, received, received, null);
  }
  if (user.role === COUNTRY_ADMIN_ROLE || !isSchoolScopedRole(user.role)) {
    return withStudents(user, received, received, null);
  }

  const identity = resolveSessionSchoolIdentity(user);
  if (!identity) {
    return emptyProjection(user, received, {
      code: "MISSING_CANONICAL_IDENTITY",
      message: STUDENT_SCOPE_MESSAGES.MISSING_CANONICAL_IDENTITY,
    });
  }

  const matched = received.filter((row) => studentMatchesSchoolIdentity(row, identity.schoolId));
  const foreignById = received.filter(
    (row) => String(row.schoolId ?? "").trim() && !sameSchoolId(row.schoolId, identity.schoolId),
  );
  const missingSchoolId = received.filter((row) => !String(row.schoolId ?? "").trim());

  if (foreignById.length) {
    return withStudents(user, received, matched, {
      code: "SCOPE_LEAK",
      message: STUDENT_SCOPE_MESSAGES.SCOPE_LEAK,
    });
  }

  if (missingSchoolId.length && matched.length > 0) {
    return withStudents(user, received, matched, {
      code: "INCOMPLETE_ROW_IDENTITY",
      message: STUDENT_SCOPE_MESSAGES.INCOMPLETE_ROW_IDENTITY,
    });
  }

  if (received.length > 0 && matched.length === 0) {
    return emptyProjection(user, received, {
      code: "SCOPE_MISMATCH",
      message: STUDENT_SCOPE_MESSAGES.SCOPE_MISMATCH,
    });
  }

  return withStudents(user, received, matched, null);
}

export function logStudentScopeTrace(trace: StudentScopeTrace): void {
  console.info(JSON.stringify(trace));
}

export function scopedStudentsBySchoolId(
  user: SessionUser | null,
  state: Pick<BackOfficeState, "students"> | { students?: unknown[] },
): StudentRow[] {
  return projectScopedStudents(user, state).students;
}
