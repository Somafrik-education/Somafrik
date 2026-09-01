import type { SessionUser, UserAccount } from "../types";
import { isSuperAdminRole, COUNTRY_ADMIN_ROLE } from "./orgHierarchy";

/** login_code V2 : {ISO}-{INITIALES}-{YY}-{SEQ3} (ex. CD-IN-26-001). */
const V2_SCHOOL_LOGIN_PATTERN = /^[A-Z]{2}-[A-Z0-9]{2,5}-\d{2}-\d{3}$/;
/** leftover historique : {ISO}-{YYYY}-{NNNN} (ex. CD-2026-0001). Jamais une autorité. */
const LEGACY_SCHOOL_CODE_PATTERN = /^[A-Z]{2}-\d{4}-\d{4}$/;

export type SchoolScopeErrorCode =
  | "MISSING_CANONICAL_IDENTITY"
  | "SCOPE_MISMATCH"
  | "SCOPE_LEAK";

export type SchoolCanonicalIdentity = {
  schoolId: string;
  publicCode: string;
};

export type UserScopeTrace = {
  kind: "users_scope_trace";
  role: string;
  session: {
    hasSchoolId: boolean;
    hasPublicCode: boolean;
    leftoverPresent: boolean;
    schoolCodeIsV2: boolean;
    leftoverEqualsPublic: boolean | null;
  };
  api: {
    received: number;
    distinctSchoolIds: number;
    distinctPublicCodes: number;
    distinctProjectedSchoolCodes: number;
  };
  kept: number;
  error: SchoolScopeErrorCode | null;
};

export type UserScopeProjection = {
  users: UserAccount[];
  error: { code: SchoolScopeErrorCode; message: string } | null;
  received: number;
  kept: number;
  trace: UserScopeTrace;
};

export function normalizeSchoolIdentity(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export function sameSchoolId(left: unknown, right: unknown): boolean {
  const a = String(left ?? "").trim().toLowerCase();
  const b = String(right ?? "").trim().toLowerCase();
  return Boolean(a && b && a === b);
}

export function isV2SchoolLoginCode(value: unknown): boolean {
  return V2_SCHOOL_LOGIN_PATTERN.test(normalizeSchoolIdentity(value));
}

export function isLegacySchoolCode(value: unknown): boolean {
  return LEGACY_SCHOOL_CODE_PATTERN.test(normalizeSchoolIdentity(value));
}

export function isSchoolScopedRole(role?: string): boolean {
  if (!role) return false;
  if (isSuperAdminRole(role) || role === COUNTRY_ADMIN_ROLE) return false;
  return true;
}

/**
 * Autorité établissement côté session :
 * 1. schoolId (UUID membership)
 * 2. schoolPublicCode (login_code)
 * 3. schoolCode uniquement s'il est déjà un login_code V2 (projection API / session alignée)
 *
 * Interdit : leftover CC-YYYY-NNNN comme autorité, fallback permissif, déduction depuis les rows.
 */
export function resolveSessionSchoolIdentity(
  user: Pick<SessionUser, "schoolId" | "schoolPublicCode" | "schoolCode"> | null,
): SchoolCanonicalIdentity | null {
  if (!user) return null;
  const schoolId = String(user.schoolId ?? "").trim();
  let publicCode = normalizeSchoolIdentity(user.schoolPublicCode);
  if (!publicCode && isV2SchoolLoginCode(user.schoolCode)) {
    publicCode = normalizeSchoolIdentity(user.schoolCode);
  }
  if (!schoolId && !publicCode) return null;
  return { schoolId, publicCode };
}

export function accountMatchesSchoolIdentity(
  account: Pick<UserAccount, "schoolId" | "schoolPublicCode" | "schoolCode">,
  identity: SchoolCanonicalIdentity,
): boolean {
  if (identity.schoolId && sameSchoolId(account.schoolId, identity.schoolId)) {
    return true;
  }
  if (!identity.publicCode) return false;
  return (
    normalizeSchoolIdentity(account.schoolPublicCode) === identity.publicCode ||
    normalizeSchoolIdentity(account.schoolCode) === identity.publicCode
  );
}

function uniqueNormalized(values: Array<unknown>): number {
  const set = new Set<string>();
  for (const value of values) {
    const next = normalizeSchoolIdentity(value);
    if (next) set.add(next);
  }
  return set.size;
}

function uniqueIds(values: Array<unknown>): number {
  const set = new Set<string>();
  for (const value of values) {
    const next = String(value ?? "").trim().toLowerCase();
    if (next) set.add(next);
  }
  return set.size;
}

export function buildUserScopeTrace(input: {
  role?: string;
  session: Pick<SessionUser, "schoolId" | "schoolPublicCode" | "schoolCode"> | null;
  received: UserAccount[];
  kept: UserAccount[];
  error: SchoolScopeErrorCode | null;
}): UserScopeTrace {
  const leftover = normalizeSchoolIdentity(input.session?.schoolCode);
  const publicCode = normalizeSchoolIdentity(input.session?.schoolPublicCode);
  const leftoverPresent = isLegacySchoolCode(leftover);
  return {
    kind: "users_scope_trace",
    role: String(input.role ?? ""),
    session: {
      hasSchoolId: Boolean(String(input.session?.schoolId ?? "").trim()),
      hasPublicCode: Boolean(publicCode),
      leftoverPresent,
      schoolCodeIsV2: isV2SchoolLoginCode(leftover),
      leftoverEqualsPublic: leftover && publicCode ? leftover === publicCode : null,
    },
    api: {
      received: input.received.length,
      distinctSchoolIds: uniqueIds(input.received.map((row) => row.schoolId)),
      distinctPublicCodes: uniqueNormalized(input.received.map((row) => row.schoolPublicCode)),
      distinctProjectedSchoolCodes: uniqueNormalized(input.received.map((row) => row.schoolCode)),
    },
    kept: input.kept.length,
    error: input.error,
  };
}

export function logUserScopeTrace(trace: UserScopeTrace): void {
  console.info(JSON.stringify(trace));
}

const SCOPE_MESSAGES: Record<SchoolScopeErrorCode, string> = {
  MISSING_CANONICAL_IDENTITY:
    "Périmètre établissement incomplet : l'identité canonique (schoolId / login_code) est absente de la session. Les comptes ne sont pas affichés.",
  SCOPE_MISMATCH:
    "Incohérence de périmètre : l'API a renvoyé des comptes, mais aucun ne correspond à l'identité établissement canonique de la session.",
  SCOPE_LEAK:
    "Alerte sécurité : la réponse utilisateurs contient un autre établissement. Ces comptes sont masqués.",
};

export function projectScopedUsersForSchool(
  user: SessionUser | null,
  visible: UserAccount[],
): UserScopeProjection {
  const received = visible;
  const identity = resolveSessionSchoolIdentity(user);
  if (!identity) {
    const error = {
      code: "MISSING_CANONICAL_IDENTITY" as const,
      message: SCOPE_MESSAGES.MISSING_CANONICAL_IDENTITY,
    };
    const trace = buildUserScopeTrace({
      role: user?.role,
      session: user,
      received,
      kept: [],
      error: error.code,
    });
    return { users: [], error, received: received.length, kept: 0, trace };
  }

  const matched = visible.filter((account) => accountMatchesSchoolIdentity(account, identity));
  const foreignById =
    identity.schoolId
      ? visible.filter(
          (account) => account.schoolId && !sameSchoolId(account.schoolId, identity.schoolId),
        )
      : [];

  if (foreignById.length) {
    const error = { code: "SCOPE_LEAK" as const, message: SCOPE_MESSAGES.SCOPE_LEAK };
    const kept = matched.filter(
      (account) => !account.schoolId || sameSchoolId(account.schoolId, identity.schoolId),
    );
    const trace = buildUserScopeTrace({
      role: user?.role,
      session: user,
      received,
      kept,
      error: error.code,
    });
    return { users: kept, error, received: received.length, kept: kept.length, trace };
  }

  if (received.length > 0 && matched.length === 0) {
    const error = { code: "SCOPE_MISMATCH" as const, message: SCOPE_MESSAGES.SCOPE_MISMATCH };
    const trace = buildUserScopeTrace({
      role: user?.role,
      session: user,
      received,
      kept: [],
      error: error.code,
    });
    return { users: [], error, received: received.length, kept: 0, trace };
  }

  const trace = buildUserScopeTrace({
    role: user?.role,
    session: user,
    received,
    kept: matched,
    error: null,
  });
  return { users: matched, error: null, received: received.length, kept: matched.length, trace };
}
