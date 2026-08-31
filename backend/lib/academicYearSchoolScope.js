"use strict";

/**
 * Autorité Academic Year (GP-002) :
 * principal.sub → users.id → users.school_id → schools.id → schools.login_code
 * Le JWT schoolCode leftover n'est plus l'autorité. login_code vide ⇒ fail-closed.
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
  return String(left ?? "").trim() === String(right ?? "").trim();
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
 * Attache academicYearLoginCode + academicYearSchoolId depuis le membership UUID.
 * Superadmin / Admin Pays globaux : pas de lookup.
 * Superadmin / Admin Pays request-scoped : école résolue côté serveur, valeur émise = login_code.
 * Rôle établissement : toujours membership UUID ; JWT / header / body ne sont pas l'autorité.
 */
async function attachAcademicYearMembershipScope(principal, one) {
  if (!principal) return principal;
  const existingLogin = normalizeLoginCode(principal.academicYearLoginCode);
  const existingId = String(principal.academicYearSchoolId ?? "").trim();
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
    return { ...principal, academicYearLoginCode: "", academicYearSchoolId: "" };
  }

  if ((platform || adminPays) && requestScoped) {
    const requested = tenantScope.normalizeSchoolCode(principal.effectiveSchoolCode);
    if (!requested) {
      return { ...principal, academicYearLoginCode: "", academicYearSchoolId: "" };
    }
    const found = await findSchoolForPlatformScope(requested, one);
    if (!found) {
      return { ...principal, academicYearLoginCode: "", academicYearSchoolId: "" };
    }
    return {
      ...principal,
      academicYearLoginCode: found.loginCode,
      academicYearSchoolId: found.schoolId,
    };
  }

  const userId = String(principal.sub ?? "").trim();
  if (!userId) {
    return { ...principal, academicYearLoginCode: "", academicYearSchoolId: "" };
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
    return { ...principal, academicYearLoginCode: "", academicYearSchoolId: "" };
  }
  return {
    ...principal,
    academicYearLoginCode: loginCode,
    academicYearSchoolId: schoolId,
  };
}

/**
 * Store mémoire : une seule identité par établissement (le schoolCode du
 * fixture EST le login_code). Ne jamais utiliser en PostgreSQL.
 */
function attachAcademicYearFixtureScope(principal) {
  if (!principal) return principal;
  const existing = normalizeLoginCode(principal.academicYearLoginCode);
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
    return { ...principal, academicYearLoginCode: "", academicYearSchoolId: "" };
  }
  return {
    ...principal,
    academicYearLoginCode: requested,
    academicYearSchoolId: String(principal.effectiveSchoolId ?? principal.schoolId ?? "").trim(),
  };
}

function resolveAcademicYearSchoolScope(principal) {
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
  const loginCode = normalizeLoginCode(principal.academicYearLoginCode);
  const schoolId = String(principal.academicYearSchoolId ?? "").trim();
  if (loginCode && loginCode !== "*") {
    return { mode: "school", schoolId, loginCode };
  }
  return { mode: "none" };
}

function academicYearCacheKey(scope) {
  if (!scope || scope.mode === "all") return "v2:academic-years";
  if (scope.mode === "none") return "v2:academic-years:none";
  if (scope.mode === "country") {
    return `v2:academic-years:country:${normalizeLoginCode(scope.countryCode)}`;
  }
  if (scope.mode === "school") {
    const id = String(scope.schoolId ?? "").trim();
    if (id) return `v2:academic-years:school:${id}`;
    return `v2:academic-years:school:${normalizeLoginCode(scope.loginCode)}`;
  }
  return "v2:academic-years";
}

function sqlAcademicYearScope(scope, params) {
  if (!scope || scope.mode === "all") return "TRUE";
  if (scope.mode === "none") return "FALSE";
  if (scope.mode === "country") {
    params.push(scope.countryCode);
    return `upper(btrim(c.iso_code)) = $${params.length}`;
  }
  if (scope.mode === "school") {
    const schoolId = String(scope.schoolId ?? "").trim();
    if (schoolId) {
      params.push(schoolId);
      return `ay.school_id = $${params.length}::uuid`;
    }
    return "FALSE";
  }
  return "FALSE";
}

function filterAcademicYearRows(rows, scope) {
  const list = Array.isArray(rows) ? rows : [];
  if (!scope || scope.mode === "all") return list;
  if (scope.mode === "none") return [];
  if (scope.mode === "country") {
    const country = normalizeLoginCode(scope.countryCode);
    return list.filter((row) => normalizeLoginCode(row.countryCode) === country);
  }
  if (scope.mode === "school") {
    if (scope.schoolId) {
      return list.filter((row) => sameId(row.schoolId, scope.schoolId));
    }
    const login = normalizeLoginCode(scope.loginCode);
    return list.filter((row) => normalizeLoginCode(row.schoolCode) === login);
  }
  return [];
}

function assertAcademicYearReadable(principal) {
  const scope = resolveAcademicYearSchoolScope(principal);
  if (scope.mode === "none") {
    failClosed("Accès refusé: établissement hors périmètre.");
  }
  return scope;
}

function assertAcademicYearPatchAccess(principal, current) {
  const scope = resolveAcademicYearSchoolScope(principal);
  if (scope.mode === "none") {
    failClosed("Accès refusé: établissement hors périmètre.");
  }
  if (scope.mode === "all") return scope;
  if (scope.mode === "country") {
    if (normalizeLoginCode(current?.countryCode) !== scope.countryCode) {
      failClosed("Accès refusé: pays hors périmètre.");
    }
    return scope;
  }
  if (scope.schoolId) {
    if (!sameId(current?.schoolId, scope.schoolId)) {
      failClosed("Accès refusé: établissement hors périmètre.");
    }
    return scope;
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

async function resolveAcademicYearWriteSchool(principal, body = {}, one) {
  const scope = resolveAcademicYearSchoolScope(principal);
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
    const error = new BusinessError(400, "Établissement, nom, date de début et date de fin sont requis.");
    throw error;
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

module.exports = {
  attachAcademicYearMembershipScope,
  attachAcademicYearFixtureScope,
  resolveAcademicYearSchoolScope,
  academicYearCacheKey,
  sqlAcademicYearScope,
  filterAcademicYearRows,
  assertAcademicYearReadable,
  assertAcademicYearPatchAccess,
  resolveAcademicYearWriteSchool,
  findSchoolForPlatformScope,
  bodyConflictsWithMembership,
  normalizeLoginCode,
};
