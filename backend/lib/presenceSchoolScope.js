"use strict";

/**
 * Autorité Présences / attendance (GP-015) :
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

function hasPresenceMembershipAttached(principal) {
  return Boolean(principal) && Object.prototype.hasOwnProperty.call(principal, "presenceLoginCode");
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
 * Attache presenceLoginCode + presenceSchoolId depuis le membership UUID.
 * Superadmin / Admin Pays globaux : pas de lookup.
 * Superadmin / Admin Pays request-scoped : école résolue côté serveur, valeur émise = login_code.
 * Rôle établissement : toujours membership UUID ; JWT / header / body ne sont pas l'autorité.
 */
async function attachPresenceMembershipScope(principal, one) {
  if (!principal) return principal;
  const existingLogin = normalizeLoginCode(principal.presenceLoginCode);
  const existingId = String(principal.presenceSchoolId ?? "").trim();
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
    return { ...principal, presenceLoginCode: "", presenceSchoolId: "" };
  }

  if ((platform || adminPays) && requestScoped) {
    const requested = tenantScope.normalizeSchoolCode(principal.effectiveSchoolCode);
    if (!requested) {
      return { ...principal, presenceLoginCode: "", presenceSchoolId: "" };
    }
    const found = await findSchoolForPlatformScope(requested, one);
    if (!found) {
      return { ...principal, presenceLoginCode: "", presenceSchoolId: "" };
    }
    return {
      ...principal,
      presenceLoginCode: found.loginCode,
      presenceSchoolId: found.schoolId,
    };
  }

  const userId = String(principal.sub ?? "").trim();
  if (!userId) {
    return { ...principal, presenceLoginCode: "", presenceSchoolId: "" };
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
    return { ...principal, presenceLoginCode: "", presenceSchoolId: "" };
  }
  return {
    ...principal,
    presenceLoginCode: loginCode,
    presenceSchoolId: schoolId,
  };
}

/**
 * Store mémoire : une seule identité par établissement (le schoolCode du
 * fixture EST le login_code). Ne jamais utiliser en PostgreSQL.
 */
function attachPresenceFixtureScope(principal) {
  if (!principal) return principal;
  const existing = normalizeLoginCode(principal.presenceLoginCode);
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
    return { ...principal, presenceLoginCode: "", presenceSchoolId: "" };
  }
  return {
    ...principal,
    presenceLoginCode: requested,
    presenceSchoolId: String(principal.effectiveSchoolId ?? principal.schoolId ?? "").trim(),
  };
}

function resolvePresenceSchoolScope(principal) {
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
  const loginCode = normalizeLoginCode(principal.presenceLoginCode);
  const schoolId = String(principal.presenceSchoolId ?? "").trim();
  if (loginCode && loginCode !== "*") {
    return { mode: "school", schoolId, loginCode };
  }
  return { mode: "none" };
}

function sqlPresenceScope(scope, params) {
  if (!scope || scope.mode === "all") return "TRUE";
  if (scope.mode === "none") return "FALSE";
  if (scope.mode === "country") {
    params.push(scope.countryCode);
    return `upper(btrim(co.iso_code)) = $${params.length}`;
  }
  if (scope.mode === "school") {
    const schoolId = String(scope.schoolId ?? "").trim();
    if (schoolId) {
      params.push(schoolId);
      return `a.school_id = $${params.length}::uuid`;
    }
    return "FALSE";
  }
  return "FALSE";
}

function filterPresenceRows(rows, scope) {
  const list = Array.isArray(rows) ? rows : [];
  if (!scope || scope.mode === "all") return list;
  if (scope.mode === "none") return [];
  if (scope.mode === "country") {
    const country = normalizeLoginCode(scope.countryCode);
    return list.filter((row) => {
      const iso = normalizeLoginCode(row.countryCode) || countryIsoFromPublicCode(row.schoolCode);
      return iso === country;
    });
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

function isStudentScopedPresenceRole(role = "") {
  const key = String(role ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return key === "enseignant" || key.includes("parent") || key.includes("eleve") || key.includes("etudiant");
}

function presenceListStaysStudentScoped(principal) {
  return isStudentScopedPresenceRole(principal?.role);
}

function assertPresenceReadable(principal) {
  const scope = resolvePresenceSchoolScope(principal);
  if (scope.mode === "none") {
    failClosed("Accès refusé: établissement hors périmètre.");
  }
  return scope;
}

function assertPresenceWriteAccess(principal, current) {
  const scope = resolvePresenceSchoolScope(principal);
  if (scope.mode === "none") {
    failClosed("Accès refusé: établissement hors périmètre.");
  }
  if (scope.mode === "all") return scope;
  if (scope.mode === "country") {
    const iso = normalizeLoginCode(current?.countryCode) || countryIsoFromPublicCode(current?.schoolCode);
    if (iso !== scope.countryCode) {
      failClosed("Accès refusé: pays hors périmètre.");
    }
    return scope;
  }
  if (scope.schoolId) {
    if (current?.schoolId && !sameId(current.schoolId, scope.schoolId)) {
      failClosed("Accès refusé: établissement hors périmètre.");
    }
    return scope;
  }
  if (normalizeLoginCode(current?.schoolCode) !== scope.loginCode) {
    failClosed("Accès refusé: établissement hors périmètre.");
  }
  return scope;
}

function projectPresenceSchoolCode(row) {
  const login = normalizeLoginCode(row?.login_code ?? row?.loginCode);
  return login || undefined;
}

module.exports = {
  attachPresenceMembershipScope,
  attachPresenceFixtureScope,
  resolvePresenceSchoolScope,
  sqlPresenceScope,
  filterPresenceRows,
  assertPresenceReadable,
  assertPresenceWriteAccess,
  findSchoolForPlatformScope,
  hasPresenceMembershipAttached,
  projectPresenceSchoolCode,
  normalizeLoginCode,
  isStudentScopedPresenceRole,
  presenceListStaysStudentScoped,
};
