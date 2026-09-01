import type { Student } from "../data/catalog";
import { isSuperAdminRole, sessionRoleToPlatformRole } from "./orgHierarchy";

export type SchoolScopeErrorCode =
  | "MISSING_CANONICAL_IDENTITY"
  | "SCOPE_MISMATCH"
  | "SCOPE_LEAK"
  | "INCOMPLETE_ROW_IDENTITY";

export type StudentScopeSession = {
  role?: string;
  user?: {
    schoolId?: string;
    schoolCode?: string;
    schoolPublicCode?: string;
    role?: string;
  };
  school?: { id?: string; code?: string };
} | null;

export type StudentScopeTrace = {
  kind: "mobile_students_scope_trace";
  role: string;
  session: {
    hasSchoolId: boolean;
    leftoverPresent: boolean;
  };
  api: {
    received: number;
    distinctSchoolIds: number;
  };
  kept: number;
  error: SchoolScopeErrorCode | null;
};

export type StudentScopeProjection = {
  students: Student[];
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

const ESTABLISHMENT_STAFF_ROLES = new Set([
  "school_admin",
  "principal",
  "proviseur",
  "prefet",
  "secretary",
  "accountant",
  "adjoint",
  "supervisor",
]);

const LEGACY_SCHOOL_CODE_PATTERN = /^[A-Z]{2}-\d{4}-\d{4}$/;

export function sameSchoolId(left: unknown, right: unknown): boolean {
  const a = String(left ?? "").trim().toLowerCase();
  const b = String(right ?? "").trim().toLowerCase();
  return Boolean(a && b && a === b);
}

export function resolveSessionSchoolId(session: StudentScopeSession): string {
  const fromUser = String(session?.user?.schoolId ?? "").trim();
  if (fromUser) return fromUser;
  return String(session?.school?.id ?? "").trim();
}

export function isLegacySchoolCode(value: unknown): boolean {
  return LEGACY_SCHOOL_CODE_PATTERN.test(String(value ?? "").trim().toUpperCase());
}

export function isEstablishmentStaffSession(session: StudentScopeSession): boolean {
  if (!session?.role) return false;
  if (ESTABLISHMENT_STAFF_ROLES.has(session.role)) return true;
  const platform = sessionRoleToPlatformRole(session.role);
  return platform === "Admin School";
}

function isPlatformUnscopedRole(session: StudentScopeSession): boolean {
  const role = session?.role;
  if (role === "super_admin" || role === "country_admin") return true;
  return isSuperAdminRole(sessionRoleToPlatformRole(role));
}

/**
 * Filtre leftover JWT vs login_code — reproduisait le 0 de l'écran Élèves.
 * Conservé uniquement pour les tests de preuve avant/après. Jamais utilisé en prod.
 */
export function legacyScopedStudentsBySchoolCode(
  session: StudentScopeSession,
  students: Student[],
): Student[] {
  const schoolCode = String(session?.user?.schoolCode ?? session?.school?.code ?? "").trim();
  if (!schoolCode || schoolCode === "*") return students;
  const expected = schoolCode.toUpperCase();
  return students.filter((row) => String(row.schoolCode ?? "").trim().toUpperCase() === expected);
}

function buildTrace(input: {
  session: StudentScopeSession;
  received: Student[];
  kept: Student[];
  error: SchoolScopeErrorCode | null;
}): StudentScopeTrace {
  const leftover = String(input.session?.user?.schoolCode ?? input.session?.school?.code ?? "").trim();
  const ids = new Set<string>();
  for (const row of input.received) {
    const id = String(row.schoolId ?? "").trim().toLowerCase();
    if (id) ids.add(id);
  }
  return {
    kind: "mobile_students_scope_trace",
    role: String(input.session?.role ?? ""),
    session: {
      hasSchoolId: Boolean(resolveSessionSchoolId(input.session)),
      leftoverPresent: isLegacySchoolCode(leftover),
    },
    api: {
      received: input.received.length,
      distinctSchoolIds: ids.size,
    },
    kept: input.kept.length,
    error: input.error,
  };
}

function wrap(
  session: StudentScopeSession,
  received: Student[],
  kept: Student[],
  error: StudentScopeProjection["error"],
): StudentScopeProjection {
  return {
    students: kept,
    error,
    received: received.length,
    kept: kept.length,
    trace: buildTrace({ session, received, kept, error: error?.code ?? null }),
  };
}

/**
 * Autorité tenant Mobile : schoolId membership uniquement.
 * Interdit : leftover CC-YYYY-NNNN, publicCode, login_code V2, OR permissif.
 */
export function projectScopedStudentsForSession(
  session: StudentScopeSession,
  students: Student[],
): StudentScopeProjection {
  const received = Array.isArray(students) ? students.filter((row) => row && typeof row === "object") : [];
  if (!session) {
    return wrap(null, received, received, null);
  }
  if (isPlatformUnscopedRole(session)) {
    return wrap(session, received, received, null);
  }

  const schoolId = resolveSessionSchoolId(session);
  const requiresCanonicalIdentity = isEstablishmentStaffSession(session);

  if (requiresCanonicalIdentity && !schoolId) {
    return wrap(session, received, [], {
      code: "MISSING_CANONICAL_IDENTITY",
      message: STUDENT_SCOPE_MESSAGES.MISSING_CANONICAL_IDENTITY,
    });
  }

  if (!schoolId) {
    // Enseignant / parent / élève : pas de leftover, pas d'invention d'autorité.
    // Le GET/L1 est déjà tenant-partitionné ; on conserve les lignes reçues.
    return wrap(session, received, received, null);
  }

  const matched = received.filter((row) => sameSchoolId(row.schoolId, schoolId));
  const foreignById = received.filter(
    (row) => String(row.schoolId ?? "").trim() && !sameSchoolId(row.schoolId, schoolId),
  );
  const missingSchoolId = received.filter((row) => !String(row.schoolId ?? "").trim());

  if (foreignById.length) {
    return wrap(session, received, matched, {
      code: "SCOPE_LEAK",
      message: STUDENT_SCOPE_MESSAGES.SCOPE_LEAK,
    });
  }

  if (missingSchoolId.length && matched.length > 0) {
    return wrap(session, received, matched, {
      code: "INCOMPLETE_ROW_IDENTITY",
      message: STUDENT_SCOPE_MESSAGES.INCOMPLETE_ROW_IDENTITY,
    });
  }

  if (received.length > 0 && matched.length === 0) {
    return wrap(session, received, [], {
      code: "SCOPE_MISMATCH",
      message: STUDENT_SCOPE_MESSAGES.SCOPE_MISMATCH,
    });
  }

  return wrap(session, received, matched, null);
}

export function logStudentScopeTrace(trace: StudentScopeTrace): void {
  console.info(JSON.stringify(trace));
}

/** Préserve schoolId / schoolPublicCode renvoyés par GET /students. */
export function attachStudentTenantIdentity<T extends Record<string, unknown>>(
  row: T,
): T & { schoolId?: string; schoolPublicCode?: string } {
  const schoolId = String(row.schoolId ?? row.school_id ?? "").trim();
  const schoolPublicCode = String(row.schoolPublicCode ?? row.school_public_code ?? "").trim();
  return {
    ...row,
    ...(schoolId ? { schoolId } : {}),
    ...(schoolPublicCode ? { schoolPublicCode } : {}),
  };
}
