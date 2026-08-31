"use strict";

/**
 * Autorité Enrollment / Students :
 * principal.sub → users.id → users.school_id → schools.id
 * schools.login_code est la projection publique canonique.
 * Le JWT / header / body / query schoolCode leftover n'est plus l'autorité.
 * login_code vide ⇒ fail-closed.
 * Aucun repli PostgreSQL vers schools.school_code dans le scope établissement.
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

function countryIsoFromPublicCode(code) {
  const iso = normalizeLoginCode(code).slice(0, 2);
  return /^[A-Z]{2}$/.test(iso) ? iso : "";
}

function failClosed(message) {
  throw new BusinessError(403, message || "Accès refusé: établissement hors périmètre.");
}

/**
 * Lookup leftover uniquement pour Superadmin / Admin Pays request-scoped.
 * Deux requêtes distinctes : aucun OR / COALESCE login_code/school_code.
 * N'émet que login_code ; vide ⇒ fail-closed.
 */
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

/**
 * Attache enrollmentLoginCode + enrollmentSchoolId depuis le membership UUID.
 * Superadmin / Admin Pays globaux : pas de lookup.
 * Superadmin / Admin Pays request-scoped : école résolue côté serveur, valeur émise = login_code.
 * Rôle établissement : toujours membership UUID ; JWT / header / body ne sont pas l'autorité.
 */
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

/**
 * Store mémoire : une seule identité par établissement (le schoolCode du
 * fixture EST le login_code). Ne jamais utiliser en PostgreSQL.
 */
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

function filterEnrollmentRows(rows, scope) {
  const list = Array.isArray(rows) ? rows : [];
  if (!scope || scope.mode === "all") return list;
  if (scope.mode === "none") return [];
  if (scope.mode === "country") {
    const country = normalizeLoginCode(scope.countryCode);
    return list.filter((row) => countryIsoFromPublicCode(row.schoolCode) === country);
  }
  if (scope.mode === "school") {
    if (scope.schoolId) {
      const byId = list.filter((row) => sameId(row.schoolId, scope.schoolId));
      if (byId.length || list.some((row) => row.schoolId)) return byId;
    }
    const login = normalizeLoginCode(scope.loginCode);
    return list.filter((row) => normalizeLoginCode(row.schoolCode) === login);
  }
  return [];
}

function assertEnrollmentReadable(principal) {
  const scope = resolveEnrollmentSchoolScope(principal);
  if (scope.mode === "none") {
    failClosed("Accès refusé: établissement hors périmètre.");
  }
  return scope;
}

/**
 * GET/POST/PATCH élèves : un établissement canonique est requis.
 * Superadmin / Admin Pays globaux ⇒ 400 (pas de listing monde / pays ici).
 */
function assertEnrollmentSchoolCode(principal) {
  const scope = assertEnrollmentReadable(principal);
  if (scope.mode !== "school") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  return scope.loginCode;
}

function assertEnrollmentStudentAccess(principal, current) {
  const scope = resolveEnrollmentSchoolScope(principal);
  if (scope.mode === "none") {
    failClosed("Accès refusé: établissement hors périmètre.");
  }
  if (scope.mode === "all") return scope;
  if (scope.mode === "country") {
    const iso = countryIsoFromPublicCode(current?.schoolCode);
    if (!iso || iso !== scope.countryCode) {
      failClosed("Accès refusé: pays hors périmètre.");
    }
    return scope;
  }
  if (scope.schoolId && current?.schoolId && !sameId(current.schoolId, scope.schoolId)) {
    failClosed("Accès refusé: établissement hors périmètre.");
  }
  if (normalizeLoginCode(current?.schoolCode) !== scope.loginCode) {
    failClosed("Accès refusé: établissement hors périmètre.");
  }
  return scope;
}

async function bodyConflictsWithMembership(bodyCode, membership, one) {
  const requested = normalizeLoginCode(bodyCode);
  if (!requested) return false;
  if (requested === membership.loginCode) return false;
  if (membership.schoolId && sameId(requested, membership.schoolId)) return false;
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
    `SELECT id
     FROM schools
     WHERE upper(btrim(login_code)) = $1
     LIMIT 1`,
    [requested],
  );
  if (otherLogin?.id && !sameId(otherLogin.id, membership.schoolId)) {
    return true;
  }
  const otherLeftover = await one(
    `SELECT id
     FROM schools
     WHERE upper(btrim(school_code)) = $1
     LIMIT 1`,
    [requested],
  );
  if (otherLeftover?.id && !sameId(otherLeftover.id, membership.schoolId)) {
    return true;
  }
  return true;
}

async function resolveEnrollmentWriteSchool(principal, body = {}, one) {
  const scope = resolveEnrollmentSchoolScope(principal);
  if (scope.mode === "none") {
    failClosed("Accès refusé: établissement hors périmètre.");
  }
  if (scope.mode === "school") {
    if (await bodyConflictsWithMembership(body.schoolCode, scope, one)) {
      failClosed("Accès refusé: établissement hors périmètre.");
    }
    if (!scope.schoolId && typeof one === "function") {
      failClosed("Accès refusé: établissement hors périmètre.");
    }
    return { schoolId: scope.schoolId, loginCode: scope.loginCode };
  }

  const requested = normalizeLoginCode(body.schoolCode || principal.effectiveSchoolCode);
  if (!requested || requested === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  if (typeof one !== "function") {
    if (scope.mode === "country") {
      const iso = countryIsoFromPublicCode(requested);
      if (!iso || iso !== scope.countryCode) {
        failClosed("Accès refusé: pays hors périmètre.");
      }
    }
    return { schoolId: "", loginCode: requested };
  }
  const found = await findSchoolForPlatformScope(requested, one);
  if (!found) {
    throw new BusinessError(404, "Établissement introuvable.");
  }
  if (scope.mode === "country") {
    const country = await one(
      `SELECT c.iso_code
       FROM schools s
       JOIN countries c ON c.id = s.country_id
       WHERE s.id::text = $1
       LIMIT 1`,
      [found.schoolId],
    );
    if (normalizeLoginCode(country?.iso_code) !== scope.countryCode) {
      failClosed("Accès refusé: pays hors périmètre.");
    }
  }
  return found;
}

function publicSchoolCodeFromRow(row) {
  return normalizeLoginCode(row?.school_login_code || row?.schoolLoginCode);
}

function projectEnrollmentApiStudent(row, loginCode) {
  if (!row) return row;
  const code = normalizeLoginCode(loginCode);
  return { ...row, schoolCode: code };
}

module.exports = {
  attachEnrollmentMembershipScope,
  attachEnrollmentFixtureScope,
  resolveEnrollmentSchoolScope,
  filterEnrollmentRows,
  assertEnrollmentReadable,
  assertEnrollmentSchoolCode,
  assertEnrollmentStudentAccess,
  resolveEnrollmentWriteSchool,
  findSchoolForPlatformScope,
  bodyConflictsWithMembership,
  publicSchoolCodeFromRow,
  projectEnrollmentApiStudent,
  normalizeLoginCode,
};
