"use strict";

/**
 * Autorité Finance (GP-005) :
 * principal.sub → users.id → users.school_id → schools.id → schools.login_code
 * Le JWT schoolCode leftover n'est plus l'autorité. Il peut rester sur le
 * principal pour compatibilité, mais le scope schools n'utilise que
 * `financeLoginCode` (login_code, ou school_code si login_code encore vide).
 */

const { TenantScopeService } = require("../services/tenantScopeService");

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);
const tenantScope = new TenantScopeService();

function normalizeLoginCode(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function publicSchoolCodeFromRow(row = {}, profile = {}) {
  return normalizeLoginCode(
    row.login_code ||
      row.loginCode ||
      row.schoolLoginCode ||
      row.code ||
      profile.loginCode ||
      row.school_code ||
      row.schoolCode ||
      profile.schoolCode,
  );
}

/**
 * Attache `financeLoginCode` depuis le membership UUID (PostgreSQL).
 * Superadmin / Admin Pays globaux : pas de lookup.
 * Superadmin request-scoped : résout l'école demandée vers login_code.
 * Sans `one` (fixtures mémoire) : fail-closed — utiliser
 * `attachFinanceFixtureScope` côté store mémoire.
 */
async function attachFinanceMembershipScope(principal, one) {
  if (!principal) return principal;
  const existing = normalizeLoginCode(principal.financeLoginCode);
  if (existing && existing !== "*") {
    return principal;
  }

  const platform = SUPER_ADMIN_ROLES.has(principal.role);
  const adminPays = principal.role === "Admin Pays";
  const requestScoped = tenantScope.hasEffectiveSchoolScope(principal);

  if ((platform || adminPays) && !requestScoped) {
    return principal;
  }

  if (typeof one !== "function") {
    return { ...principal, financeLoginCode: "" };
  }

  if (requestScoped) {
    const requested = tenantScope.normalizeSchoolCode(principal.effectiveSchoolCode);
    if (!requested) return { ...principal, financeLoginCode: "" };
    const row = await one(
      `SELECT coalesce(nullif(btrim(login_code), ''), school_code) AS login_code
       FROM schools
       WHERE upper(btrim(coalesce(login_code, ''))) = $1
          OR upper(btrim(school_code)) = $1
       LIMIT 1`,
      [requested],
    );
    return { ...principal, financeLoginCode: normalizeLoginCode(row?.login_code) };
  }

  const userId = String(principal.sub ?? "").trim();
  if (!userId) return { ...principal, financeLoginCode: "" };
  const row = await one(
    `SELECT coalesce(nullif(btrim(s.login_code), ''), s.school_code) AS login_code
     FROM users u
     INNER JOIN schools s ON s.id = u.school_id
     WHERE u.id::text = $1
     LIMIT 1`,
    [userId],
  );
  return { ...principal, financeLoginCode: normalizeLoginCode(row?.login_code) };
}

/**
 * Store mémoire : une seule identité par établissement (le schoolCode du
 * fixture EST le login_code). Ne jamais utiliser en PostgreSQL — leftover
 * JWT y est distinct de login_code.
 */
function attachFinanceFixtureScope(principal) {
  if (!principal) return principal;
  const existing = normalizeLoginCode(principal.financeLoginCode);
  if (existing && existing !== "*") {
    return principal;
  }
  const platform = SUPER_ADMIN_ROLES.has(principal.role);
  const adminPays = principal.role === "Admin Pays";
  const requestScoped = tenantScope.hasEffectiveSchoolScope(principal);
  if ((platform || adminPays) && !requestScoped) {
    return principal;
  }
  const requested = requestScoped
    ? tenantScope.normalizeSchoolCode(principal.effectiveSchoolCode)
    : normalizeLoginCode(principal.schoolCode);
  if (!requested || requested === "*") {
    return { ...principal, financeLoginCode: "" };
  }
  return { ...principal, financeLoginCode: requested };
}

function resolveFinanceSchoolScope(principal) {
  if (!principal) {
    return { mode: "all" };
  }
  const platform = SUPER_ADMIN_ROLES.has(principal.role);
  if (platform && !tenantScope.hasEffectiveSchoolScope(principal)) {
    return { mode: "all" };
  }
  if (principal.role === "Admin Pays" && !tenantScope.hasEffectiveSchoolScope(principal)) {
    const countryCode = String(principal.countryCode || "").trim().toUpperCase();
    if (!countryCode) return { mode: "none" };
    return { mode: "country", countryCode };
  }
  const membership = normalizeLoginCode(principal.financeLoginCode);
  if (membership && membership !== "*") {
    return { mode: "schools", codes: [membership] };
  }
  return { mode: "none" };
}

function sqlSchoolPredicate(alias, scope, params) {
  if (scope.mode === "all") return "TRUE";
  if (scope.mode === "none") return "FALSE";
  if (scope.mode === "country") {
    params.push(scope.countryCode);
    return `EXISTS (
      SELECT 1 FROM countries _fin_c
      WHERE _fin_c.id = ${alias}.country_id
        AND upper(btrim(_fin_c.iso_code)) = $${params.length}
    )`;
  }
  params.push(scope.codes);
  return `upper(btrim(coalesce(nullif(${alias}.login_code, ''), ${alias}.school_code))) = ANY($${params.length}::text[])`;
}

function countryIsoFromRecord(record) {
  if (!record || typeof record !== "object") return "";
  for (const value of [record.countryIso, record.country_iso, record.countryIsoCode, record.iso_code]) {
    const iso = String(value ?? "").trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(iso)) return iso;
  }
  return "";
}

function schoolCodeInScope(schoolCode, scope, extras = {}) {
  if (scope.mode === "all") return true;
  if (scope.mode === "none") return false;
  if (scope.mode === "country") {
    const iso = String(extras.countryIso || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(iso)) return false;
    return iso === scope.countryCode;
  }
  const code = normalizeLoginCode(schoolCode);
  if (!code) return false;
  return scope.codes.includes(code);
}

function schoolRecordInFinanceScope(record, scope) {
  if (scope.mode === "all") return true;
  if (scope.mode === "none") return false;
  if (scope.mode === "country") {
    const iso = countryIsoFromRecord(record);
    return Boolean(iso) && iso === scope.countryCode;
  }
  const publicCode = publicSchoolCodeFromRow(record);
  if (publicCode && schoolCodeInScope(publicCode, scope)) return true;
  return schoolCodeInScope(record?.schoolCode || record?.school_code, scope);
}

function primaryFinanceSchoolCode(principal) {
  const scope = resolveFinanceSchoolScope(principal);
  if (scope.mode !== "schools" || !Array.isArray(scope.codes) || !scope.codes.length) {
    return "";
  }
  return scope.codes[0];
}

module.exports = {
  attachFinanceMembershipScope,
  attachFinanceFixtureScope,
  resolveFinanceSchoolScope,
  sqlSchoolPredicate,
  schoolCodeInScope,
  schoolRecordInFinanceScope,
  countryIsoFromRecord,
  primaryFinanceSchoolCode,
  publicSchoolCodeFromRow,
};
