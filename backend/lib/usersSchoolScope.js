"use strict";

/**
 * Autorité Users (GP-003) :
 * principal.sub → users.id → users.school_id → schools.id
 * schools.login_code est la projection publique canonique.
 * Le JWT schoolCode leftover n'est plus l'autorité. login_code vide ⇒ fail-closed.
 * Aucun repli PostgreSQL vers schools.school_code dans le scope établissement.
 */

const { TenantScopeService } = require("../services/tenantScopeService");
const { CLIENTS_ERROR, createClientsError } = require("./clientsManagement");

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

function failClosed(message, code = CLIENTS_ERROR.TENANT_MISMATCH) {
  throw createClientsError(
    403,
    message || "Accès refusé : établissement hors périmètre.",
    code,
  );
}

function sqlOneFromStore(store) {
  if (typeof store?.one === "function" && typeof store?.query === "function") {
    return store.one.bind(store);
  }
  if (typeof store?.bind === "function") {
    const bound = store.bind({});
    if (typeof bound?.one === "function" && typeof bound?.query === "function") {
      return bound.one.bind(bound);
    }
  }
  return null;
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
 * Attache usersLoginCode + usersSchoolId depuis le membership UUID.
 * Superadmin / Admin Pays globaux : pas de lookup.
 * Superadmin / Admin Pays request-scoped : école résolue côté serveur, valeur émise = login_code.
 * Rôle établissement : toujours membership UUID ; JWT / header / body ne sont pas l'autorité.
 */
async function attachUsersMembershipScope(principal, one) {
  if (!principal) return principal;
  const existingLogin = normalizeLoginCode(principal.usersLoginCode);
  const existingId = String(principal.usersSchoolId ?? "").trim();
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
    return { ...principal, usersLoginCode: "", usersSchoolId: "" };
  }

  if ((platform || adminPays) && requestScoped) {
    const requested = tenantScope.normalizeSchoolCode(principal.effectiveSchoolCode);
    if (!requested) {
      return { ...principal, usersLoginCode: "", usersSchoolId: "" };
    }
    const found = await findSchoolForPlatformScope(requested, one);
    if (!found) {
      return { ...principal, usersLoginCode: "", usersSchoolId: "" };
    }
    return {
      ...principal,
      usersLoginCode: found.loginCode,
      usersSchoolId: found.schoolId,
    };
  }

  const userId = String(principal.sub ?? "").trim();
  if (!userId) {
    return { ...principal, usersLoginCode: "", usersSchoolId: "" };
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
    return { ...principal, usersLoginCode: "", usersSchoolId: "" };
  }
  return {
    ...principal,
    usersLoginCode: loginCode,
    usersSchoolId: schoolId,
  };
}

/**
 * Store mémoire : une seule identité par établissement (le schoolCode du
 * fixture EST le login_code). Ne jamais utiliser en PostgreSQL.
 */
function attachUsersFixtureScope(principal) {
  if (!principal) return principal;
  const existing = normalizeLoginCode(principal.usersLoginCode);
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
    return { ...principal, usersLoginCode: "", usersSchoolId: "" };
  }
  return {
    ...principal,
    usersLoginCode: requested,
    usersSchoolId: String(principal.effectiveSchoolId ?? principal.schoolId ?? "").trim(),
  };
}

async function attachUsersStorePrincipal(principal, store) {
  const one = sqlOneFromStore(store);
  if (one) {
    return attachUsersMembershipScope(principal, one);
  }
  return attachUsersFixtureScope(principal);
}

function resolveUsersSchoolScope(principal) {
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
  const loginCode = normalizeLoginCode(principal.usersLoginCode);
  const schoolId = String(principal.usersSchoolId ?? "").trim();
  if (loginCode && loginCode !== "*") {
    return { mode: "school", schoolId, loginCode };
  }
  return { mode: "none" };
}

function sqlUsersScope(scope, params) {
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
      return `u.school_id = $${params.length}::uuid`;
    }
    return "FALSE";
  }
  return "FALSE";
}

function filterUsersRows(rows, scope) {
  const list = Array.isArray(rows) ? rows : [];
  if (!scope || scope.mode === "all") return list;
  if (scope.mode === "none") return [];
  if (scope.mode === "country") {
    const country = normalizeLoginCode(scope.countryCode);
    return list.filter((row) => normalizeLoginCode(row.countryCode) === country);
  }
  if (scope.mode === "school") {
    if (scope.schoolId) {
      return list.filter((row) => sameId(row.schoolId ?? row.school_id, scope.schoolId));
    }
    const login = normalizeLoginCode(scope.loginCode);
    return list.filter(
      (row) =>
        normalizeLoginCode(row.schoolPublicCode) === login ||
        normalizeLoginCode(row.schoolCode) === login,
    );
  }
  return [];
}

function assertUsersReadable(principal) {
  const scope = resolveUsersSchoolScope(principal);
  if (scope.mode === "none") {
    failClosed("Accès refusé : établissement hors périmètre.");
  }
  return scope;
}

function targetFromUserRow(row = {}) {
  return {
    schoolId: row.schoolId ?? row.school_id,
    schoolCode: row.schoolPublicCode || row.school_login_code || row.schoolCode || row.school_code,
    countryCode: row.countryCode || row.country_code,
  };
}

function assertUsersTargetAccess(principal, current) {
  const scope = resolveUsersSchoolScope(principal);
  if (scope.mode === "none") {
    failClosed("Accès refusé : établissement hors périmètre.");
  }
  if (scope.mode === "all") return scope;
  if (scope.mode === "country") {
    if (normalizeLoginCode(current?.countryCode) !== scope.countryCode) {
      failClosed("Accès refusé : établissement hors pays.");
    }
    return scope;
  }
  if (scope.schoolId) {
    if (!sameId(current?.schoolId ?? current?.school_id, scope.schoolId)) {
      failClosed("Accès refusé : établissement hors périmètre.");
    }
    return scope;
  }
  const currentLogin = normalizeLoginCode(
    current?.schoolPublicCode || current?.schoolCode || current?.school_code,
  );
  if (currentLogin !== scope.loginCode) {
    failClosed("Accès refusé : établissement hors périmètre.");
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

async function resolveUsersWriteSchool(principal, body = {}, one) {
  const scope = resolveUsersSchoolScope(principal);
  if (scope.mode === "none") {
    failClosed("Accès refusé : établissement hors périmètre.");
  }
  if (scope.mode === "school") {
    if (await bodyConflictsWithMembership(body.schoolCode || body.schoolId, scope, one)) {
      failClosed("Accès refusé : établissement hors périmètre.");
    }
    if (!scope.schoolId && typeof one === "function") {
      failClosed("Accès refusé : établissement hors périmètre.");
    }
    return { schoolId: scope.schoolId, loginCode: scope.loginCode };
  }

  const requested = normalizeLoginCode(body.schoolCode || body.schoolId || principal.effectiveSchoolCode);
  if (!requested || requested === "*") {
    if (scope.mode === "all" && isPlatformPrincipal(principal) && !requested) {
      return { schoolId: "", loginCode: "" };
    }
    throw createClientsError(400, "Établissement obligatoire.", CLIENTS_ERROR.INVALID_TENANT_SCOPE);
  }
  if (typeof one !== "function") {
    if (scope.mode === "country") {
      const iso = countryIsoFromPublicCode(requested);
      if (!iso || iso !== scope.countryCode) {
        failClosed("Accès refusé : établissement hors pays.");
      }
    }
    return { schoolId: "", loginCode: requested };
  }
  const found = await findSchoolForPlatformScope(requested, one);
  if (!found) {
    throw createClientsError(404, "Établissement introuvable.", CLIENTS_ERROR.SCHOOL_NOT_FOUND);
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
      failClosed("Accès refusé : établissement hors pays.");
    }
  }
  return found;
}

function projectUsersApiUser(user) {
  if (!user || typeof user !== "object") return user;
  const login = normalizeLoginCode(user.schoolPublicCode);
  if (!login) return user;
  return { ...user, schoolCode: login };
}

module.exports = {
  attachUsersMembershipScope,
  attachUsersFixtureScope,
  attachUsersStorePrincipal,
  resolveUsersSchoolScope,
  sqlUsersScope,
  filterUsersRows,
  assertUsersReadable,
  assertUsersTargetAccess,
  resolveUsersWriteSchool,
  findSchoolForPlatformScope,
  bodyConflictsWithMembership,
  projectUsersApiUser,
  targetFromUserRow,
  sqlOneFromStore,
  normalizeLoginCode,
};
