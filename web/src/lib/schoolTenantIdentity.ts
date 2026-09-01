import type { SessionUser, UserAccount } from "../types";
import { COUNTRY_ADMIN_ROLE, isSuperAdminRole } from "./orgHierarchy";

/** Format public V2 : {ISO}-{INITIALES}-{YY}-{SEQ3} — ex. CD-IN-26-001 */
const V2_SCHOOL_LOGIN_PATTERN = /^[A-Z]{2}-[A-Z0-9]{2,5}-\d{2}-\d{3}$/;
/** Alias historique leftover : {ISO}-{YYYY}-{SEQ4} — ex. CD-2026-0001 */
const LEGACY_SCHOOL_CODE_PATTERN = /^[A-Z]{2}-\d{4}-\d{4}$/;

export type SchoolCodeKind = "v2" | "legacy" | "other" | "empty";

export type UsersScopeErrorCode =
  | "CANONICAL_IDENTITY_MISSING"
  | "SCOPE_INCONSISTENCY"
  | "MULTI_TENANT_RESPONSE";

export type SessionSchoolScope =
  | { mode: "all" }
  | { mode: "country"; countryScope: string }
  | { mode: "school"; schoolId: string; publicCode: string }
  | { mode: "none"; error: UsersScopeErrorCode };

export interface UsersScopeTrace {
  sessionHasSchoolId: boolean;
  sessionPublicCodeKind: SchoolCodeKind;
  leftoverDiffersFromPublic: boolean;
  backendCanonical: "school_id";
  received: number;
  kept: number;
  distinctTenantIds: number;
  error: UsersScopeErrorCode | null;
  security: boolean;
}

export interface DiagnoseScopedUsersResult {
  users: UserAccount[];
  trace: UsersScopeTrace;
}

export function sameSchoolId(left: unknown, right: unknown): boolean {
  const a = String(left ?? "").trim().toLowerCase();
  const b = String(right ?? "").trim().toLowerCase();
  return Boolean(a && b && a === b);
}

export function normalizePublicSchoolCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function schoolCodeKind(value: unknown): SchoolCodeKind {
  const normalized = normalizePublicSchoolCode(value);
  if (!normalized) return "empty";
  if (V2_SCHOOL_LOGIN_PATTERN.test(normalized)) return "v2";
  if (LEGACY_SCHOOL_CODE_PATTERN.test(normalized)) return "legacy";
  return "other";
}

function isCanonicalPublicCode(value: unknown): boolean {
  const kind = schoolCodeKind(value);
  return kind === "v2" || kind === "other";
}

export function attachCanonicalSchoolIdentity<T extends {
  schoolId?: string;
  schoolPublicCode?: string;
  schoolContext?: { id?: string; schoolId?: string; loginCode?: string; publicId?: string; code?: string };
}>(user: T | null | undefined, schoolContext?: T["schoolContext"]): T | null {
  if (!user) return null;
  const context = schoolContext ?? user.schoolContext;
  const schoolId =
    String(user.schoolId ?? "").trim() ||
    String(context?.id ?? context?.schoolId ?? "").trim();
  const fromUser = normalizePublicSchoolCode(user.schoolPublicCode);
  const fromContext = normalizePublicSchoolCode(context?.loginCode || context?.publicId);
  const schoolPublicCode = isCanonicalPublicCode(fromUser)
    ? fromUser
    : isCanonicalPublicCode(fromContext)
      ? fromContext
      : "";
  return {
    ...user,
    ...(schoolId ? { schoolId } : {}),
    ...(schoolPublicCode ? { schoolPublicCode } : {}),
  };
}

export function resolveSessionSchoolScope(user: SessionUser | null): SessionSchoolScope {
  if (!user) return { mode: "none", error: "CANONICAL_IDENTITY_MISSING" };
  if (isSuperAdminRole(user.role)) return { mode: "all" };
  if (user.role === COUNTRY_ADMIN_ROLE) {
    const countryScope = String(user.countryScope ?? "").trim();
    if (!countryScope) return { mode: "none", error: "CANONICAL_IDENTITY_MISSING" };
    return { mode: "country", countryScope };
  }

  const schoolId = String(user.schoolId ?? "").trim();
  const publicCode = normalizePublicSchoolCode(user.schoolPublicCode);
  const publicOk = publicCode && isCanonicalPublicCode(publicCode);
  if (schoolId) {
    return { mode: "school", schoolId, publicCode: publicOk ? publicCode : "" };
  }
  if (publicOk) {
    return { mode: "school", schoolId: "", publicCode };
  }
  return { mode: "none", error: "CANONICAL_IDENTITY_MISSING" };
}

export function accountMatchesSchoolScope(
  account: Pick<UserAccount, "schoolId" | "schoolPublicCode" | "schoolCode">,
  scope: Extract<SessionSchoolScope, { mode: "school" }>,
): boolean {
  const accountId = String(account.schoolId ?? "").trim();
  if (scope.schoolId && accountId) {
    return sameSchoolId(accountId, scope.schoolId);
  }

  const accountPublic = normalizePublicSchoolCode(account.schoolPublicCode);
  const accountCode = normalizePublicSchoolCode(account.schoolCode);
  const candidates = [
    accountPublic,
    isCanonicalPublicCode(accountCode) ? accountCode : "",
  ].filter(Boolean);

  if (!scope.publicCode) return false;
  return candidates.includes(scope.publicCode);
}

export function schoolMatchesSessionScope(
  school: { id?: string; schoolId?: string; code?: string; loginCode?: string; publicId?: string },
  scope: Extract<SessionSchoolScope, { mode: "school" }>,
): boolean {
  const schoolId = String(school.id ?? school.schoolId ?? "").trim();
  if (scope.schoolId && schoolId && sameSchoolId(schoolId, scope.schoolId)) {
    return true;
  }
  if (!scope.publicCode) return false;
  const candidates = [school.loginCode, school.publicId, school.code]
    .map(normalizePublicSchoolCode)
    .filter((code) => code && isCanonicalPublicCode(code));
  return candidates.includes(scope.publicCode);
}

function emptyTrace(partial: Partial<UsersScopeTrace>): UsersScopeTrace {
  return {
    sessionHasSchoolId: false,
    sessionPublicCodeKind: "empty",
    leftoverDiffersFromPublic: false,
    backendCanonical: "school_id",
    received: 0,
    kept: 0,
    distinctTenantIds: 0,
    error: null,
    security: false,
    ...partial,
  };
}

export function buildUsersScopeTrace(
  user: SessionUser | null,
  receivedUsers: UserAccount[],
  keptUsers: UserAccount[],
  error: UsersScopeErrorCode | null,
): UsersScopeTrace {
  const leftover = normalizePublicSchoolCode(user?.schoolCode);
  const publicCode = normalizePublicSchoolCode(user?.schoolPublicCode);
  const tenantIds = new Set(
    receivedUsers
      .map((account) => String(account.schoolId ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  return emptyTrace({
    sessionHasSchoolId: Boolean(String(user?.schoolId ?? "").trim()),
    sessionPublicCodeKind: schoolCodeKind(publicCode || leftover),
    leftoverDiffersFromPublic: Boolean(
      leftover && publicCode && leftover !== publicCode,
    ),
    received: receivedUsers.length,
    kept: keptUsers.length,
    distinctTenantIds: tenantIds.size,
    error,
    security: error === "MULTI_TENANT_RESPONSE",
  });
}

export function logUsersScopeTrace(trace: UsersScopeTrace): void {
  console.info(
    JSON.stringify({
      kind: "users_client_scope_trace",
      ...trace,
    }),
  );
}

export function usersScopeErrorMessage(error: UsersScopeErrorCode | null): string | null {
  if (error === "CANONICAL_IDENTITY_MISSING") {
    return "Identité établissement canonique absente. Reconnectez-vous. Les comptes ne sont pas affichés.";
  }
  if (error === "SCOPE_INCONSISTENCY") {
    return "Incohérence de périmètre établissement : la réponse serveur n'a pas pu être rattachée à l'identité canonique. Les comptes ne sont pas affichés.";
  }
  if (error === "MULTI_TENANT_RESPONSE") {
    return "Sécurité : la réponse utilisateurs mélange plusieurs établissements. Affichage bloqué.";
  }
  return null;
}
