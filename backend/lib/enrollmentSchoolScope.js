"use strict";

/**
 * Autorité Enrollment / Students (P0) :
 * principal.sub → users.id → users.school_id → schools.id
 * schools.login_code est la projection publique canonique.
 * Le JWT leftover n'est pas l'autorité. login_code vide ⇒ fail-closed.
 * Aucun COALESCE / OR leftover dans le lookup d'autorité établissement.
 */

const { BusinessError } = require("../services/authService");
const { TenantScopeService } = require("../services/tenantScopeService");

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);
const tenantScope = new TenantScopeService();

function normalizeLoginCode(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function sameId(left, right) {
  return String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
}

function isPlatformPrincipal(principal) {
  return SUPER_ADMIN_ROLES.has(String(principal?.role ?? "").trim());
}

function isCountryAdminPrincipal(principal) {
  return String(principal?.role ?? "").trim() === "Admin Pays";
}

function failClosed(message) {
  throw new BusinessError(403, message || "Accès refusé : établissement hors périmètre.");
}

function requireEstablishmentLogin(scope) {
  if (!scope || scope.mode === "none") {
    failClosed("Accès refusé : établissement hors périmètre.");
  }
  if (scope.mode !== "school" || !scope.loginCode) {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  return scope;
}

async function findSchoolForPlatformScope(requested, one) {
  const code = normalizeLoginCode(requested);
  if (!code || code === "*" || typeof one !== "function") return null;
  const byLogin = await one(
    `SELECT id, login_code
     FROM schools
     WHERE upper(btrim(login_code)) = $1
     LIMIT 1`,
    [code],
  );
  const loginFromCanonical = normalizeLoginCode(byLogin?.login_code);
  if (byLogin?.id && loginFromCanonical) {
    return { schoolId: byLogin.id, loginCode: loginFromCanonical };
  }
  const leftoverHit = await one(
    `SELECT id, login_code
     FROM schools
     WHERE upper(btrim(school_code)) = $1
     LIMIT 1`,
    [code],
  );
  const emitted = normalizeLoginCode(leftoverHit?.login_code);
  if (leftoverHit?.id && emitted) {
    return { schoolId: leftoverHit.id, loginCode: emitted };
  }
  return null;
}

async function attachEnrollmentMembershipScope(principal, one) {
  if (!principal) return principal;
  const existingLogin = normalizeLoginCode(principal.enrollmentLoginCode);
  const existingId = String(principal.enrollmentSchoolId ?? "").trim();
  if (existingLogin && existingLogin !== "*" && existingId) {
    return principal;
  }

  const platform = isPlatformPrincipal(principal);
  const adminPays = isCountryAdminPrincipal(principal);
  const requestScoped = tenantScope.hasEffectiveSchoolScope(principal);

  if ((platform || adminPays) && !requestScoped) {
    return principal;
  }

  if (typeof one !== "function") {
    return { ...principal, enrollmentLoginCode: "", enrollmentSchoolId: "" };
  }

  if ((platform || adminPays) && requestScoped) {
    const requested = tenantScope.normalizeSchoolCode(principal.effectiveSchoolCode);
    if (!requested) {
      return { ...principal, enrollmentLoginCode: "", enrollmentSchoolId: "" };
    }
    const found = await findSchoolForPlatformScope(requested, one);
    if (!found) {
      return { ...principal, enrollmentLoginCode: "", enrollmentSchoolId: "" };
    }
    return {
      ...principal,
      enrollmentLoginCode: found.loginCode,
      enrollmentSchoolId: found.schoolId,
    };
  }

  const userId = String(principal.sub ?? "").trim();
  if (!userId) {
    return { ...principal, enrollmentLoginCode: "", enrollmentSchoolId: "" };
  }
  const row = await one(
    `SELECT s.id AS school_id, s.login_code
     FROM users u
     INNER JOIN schools s ON s.id = u.school_id
     WHERE u.id::text = $1
     LIMIT 1`,
    [userId],
  );
  const loginCode = normalizeLoginCode(row?.login_code);
  const schoolId = String(row?.school_id ?? "").trim();
  if (!schoolId || !loginCode) {
    return { ...principal, enrollmentLoginCode: "", enrollmentSchoolId: "" };
  }
  return {
    ...principal,
    enrollmentLoginCode: loginCode,
    enrollmentSchoolId: schoolId,
  };
}

function attachEnrollmentFixtureScope(principal) {
  if (!principal) return principal;
  const existing = normalizeLoginCode(principal.enrollmentLoginCode);
  if (existing && existing !== "*") {
    return principal;
  }
  const platform = isPlatformPrincipal(principal);
  const adminPays = isCountryAdminPrincipal(principal);
  const requestScoped = tenantScope.hasEffectiveSchoolScope(principal);
  if ((platform || adminPays) && !requestScoped) {
    return principal;
  }
  const requested =
    (platform || adminPays) && requestScoped
      ? tenantScope.normalizeSchoolCode(principal.effectiveSchoolCode)
      : normalizeLoginCode(principal.schoolCode);
  if (!requested || requested === "*") {
    return { ...principal, enrollmentLoginCode: "", enrollmentSchoolId: "" };
  }
  return {
    ...principal,
    enrollmentLoginCode: requested,
    enrollmentSchoolId: String(principal.effectiveSchoolId ?? principal.schoolId ?? "").trim(),
  };
}

async function attachEnrollmentMemoryMembership(principal, store) {
  if (!principal) return principal;
  const existingLogin = normalizeLoginCode(principal.enrollmentLoginCode);
  const existingId = String(principal.enrollmentSchoolId ?? "").trim();
  if (existingLogin && existingLogin !== "*" && existingId) {
    return principal;
  }

  const platform = isPlatformPrincipal(principal);
  const adminPays = isCountryAdminPrincipal(principal);
  const requestScoped = tenantScope.hasEffectiveSchoolScope(principal);
  if ((platform || adminPays) && !requestScoped) {
    return principal;
  }
  if (!store) {
    return { ...principal, enrollmentLoginCode: "", enrollmentSchoolId: "" };
  }

  if ((platform || adminPays) && requestScoped) {
    const requested = tenantScope.normalizeSchoolCode(principal.effectiveSchoolCode);
    if (!requested || typeof store.getSchoolByCode !== "function") {
      return { ...principal, enrollmentLoginCode: "", enrollmentSchoolId: "" };
    }
    const school = await store.getSchoolByCode(requested);
    const loginCode = normalizeLoginCode(school?.login_code || school?.loginCode);
    const schoolId = String(school?.id ?? "").trim();
    if (!schoolId || !loginCode) {
      return { ...principal, enrollmentLoginCode: "", enrollmentSchoolId: "" };
    }
    return { ...principal, enrollmentLoginCode: loginCode, enrollmentSchoolId: schoolId };
  }

  const userId = String(principal.sub ?? "").trim();
  if (!userId) {
    return { ...principal, enrollmentLoginCode: "", enrollmentSchoolId: "" };
  }
  let schoolId = "";
  let loginCode = "";
  if (typeof store.getUserById === "function") {
    const user = await store.getUserById(userId);
    schoolId = String(user?.school_id ?? user?.schoolId ?? "").trim();
    loginCode = normalizeLoginCode(user?.school_login_code || user?.schoolPublicCode);
  }
  if ((!schoolId || !loginCode) && store._tables) {
    const role = (store._tables.userRoles ?? []).find(
      (row) =>
        String(row.user_id ?? "") === userId &&
        row.status === "active" &&
        !row.revoked_at &&
        row.school_id,
    );
    if (role?.school_id) {
      schoolId = String(role.school_id).trim();
    }
  }
  if (schoolId && !loginCode && typeof store.getSchoolById === "function") {
    const school = await store.getSchoolById(schoolId);
    loginCode = normalizeLoginCode(school?.login_code || school?.loginCode);
  }
  if (!schoolId || !loginCode) {
    return { ...principal, enrollmentLoginCode: "", enrollmentSchoolId: "" };
  }
  return {
    ...principal,
    enrollmentLoginCode: loginCode,
    enrollmentSchoolId: schoolId,
  };
}

function resolveEnrollmentSchoolScope(principal) {
  if (!principal) {
    return { mode: "all" };
  }
  const platform = isPlatformPrincipal(principal);
  if (platform && !tenantScope.hasEffectiveSchoolScope(principal)) {
    return { mode: "all" };
  }
  if (isCountryAdminPrincipal(principal) && !tenantScope.hasEffectiveSchoolScope(principal)) {
    const countryCode = String(principal.countryCode || "").trim().toUpperCase();
    if (!countryCode) return { mode: "none" };
    return { mode: "country", countryCode };
  }
  const loginCode = normalizeLoginCode(principal.enrollmentLoginCode);
  const schoolId = String(principal.enrollmentSchoolId ?? "").trim();
  if (loginCode && loginCode !== "*") {
    return { mode: "school", schoolId, loginCode };
  }
  return { mode: "none" };
}

function assertEnrollmentReadable(principal) {
  return requireEstablishmentLogin(resolveEnrollmentSchoolScope(principal));
}

async function bodyConflictsWithMembership(bodyCode, membership, one) {
  const requestedRaw = String(bodyCode ?? "").trim();
  if (!requestedRaw) return false;
  if (membership.schoolId && sameId(requestedRaw, membership.schoolId)) {
    return false;
  }
  const requested = normalizeLoginCode(bodyCode);
  if (requested === membership.loginCode) return false;
  if (typeof one !== "function") {
    return requested !== membership.loginCode;
  }
  const own = await one(
    `SELECT school_code
     FROM schools
     WHERE id::text = $1
     LIMIT 1`,
    [membership.schoolId],
  );
  if (normalizeLoginCode(own?.school_code) === requested) {
    return false;
  }
  const otherLogin = await one(
    `SELECT id FROM schools WHERE upper(btrim(login_code)) = $1 LIMIT 1`,
    [requested],
  );
  if (otherLogin?.id && !sameId(otherLogin.id, membership.schoolId)) {
    return true;
  }
  const otherLeftover = await one(
    `SELECT id FROM schools WHERE upper(btrim(school_code)) = $1 LIMIT 1`,
    [requested],
  );
  if (otherLeftover?.id && !sameId(otherLeftover.id, membership.schoolId)) {
    return true;
  }
  return true;
}

async function resolveEnrollmentWriteSchool(principal, body = {}, one) {
  const scope = requireEstablishmentLogin(resolveEnrollmentSchoolScope(principal));
  const bodySchoolId = String(body.schoolId ?? body.school_id ?? "").trim();
  if (bodySchoolId && scope.schoolId && !sameId(bodySchoolId, scope.schoolId)) {
    failClosed("Accès refusé : établissement hors périmètre.");
  }
  // schoolCode dans le corps est un champ immuable : 400 (contrat fiche / enroll),
  // pas un 403 tenant. UUID établissement étranger reste 403 ci-dessus.
  if (await bodyConflictsWithMembership(body.schoolCode ?? body.school_code, scope, one)) {
    throw new BusinessError(400, "schoolCode contradictoire.");
  }
  return { schoolId: scope.schoolId, loginCode: scope.loginCode };
}

function projectEnrollmentApiStudent(row, scope) {
  if (!row || typeof row !== "object") return row;
  const login = normalizeLoginCode(scope?.loginCode || row.schoolPublicCode || row.schoolLoginCode);
  if (!login) return { ...row };
  return { ...row, schoolCode: login, schoolPublicCode: login };
}

module.exports = {
  attachEnrollmentMembershipScope,
  attachEnrollmentFixtureScope,
  attachEnrollmentMemoryMembership,
  resolveEnrollmentSchoolScope,
  assertEnrollmentReadable,
  resolveEnrollmentWriteSchool,
  projectEnrollmentApiStudent,
  findSchoolForPlatformScope,
  normalizeLoginCode,
};
