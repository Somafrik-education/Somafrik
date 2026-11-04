"use strict";

/**
 * PERF-PR1 — résout le périmètre de lecture des projections.
 * L'identifiant d'établissement vient du membership déjà validé
 * (présences / finance), jamais d'un school_id client non revérifié.
 * null = aucune lecture. { platform: true } uniquement pour le mode
 * présence « all » déjà défini (superadmin hors request-scope).
 * La finance scolaire ne reçoit jamais ce mode.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const {
  attachPresenceMembershipScope,
  attachPresenceFixtureScope,
  resolvePresenceSchoolScope,
} = require("./presenceSchoolScope");
const {
  attachFinanceMembershipScope,
  attachFinanceFixtureScope,
  resolveFinanceSchoolScope,
} = require("./financeSchoolScope");

function isUuid(value) {
  return UUID_RE.test(String(value ?? "").trim());
}

function countryScope(countryCode) {
  const country = String(countryCode ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? { countryCode: country } : null;
}

function pedagogyScopeFromResolved(scope, { memory = false } = {}) {
  if (!scope || scope.mode === "none") return null;
  if (scope.mode === "all") return { platform: true };
  if (scope.mode === "country") return countryScope(scope.countryCode);
  if (scope.mode !== "school") return null;
  if (memory) {
    const loginCode = String(scope.loginCode ?? "").trim().toUpperCase();
    return loginCode && loginCode !== "*" ? { loginCode } : null;
  }
  const schoolId = String(scope.schoolId ?? "").trim();
  return isUuid(schoolId) ? { schoolId } : null;
}

function financeScopeFromResolved(scope, { memory = false } = {}) {
  if (!scope || scope.mode === "none" || scope.mode === "all") return null;
  if (scope.mode === "country") return countryScope(scope.countryCode);
  if (scope.mode !== "schools") return null;
  const loginCode = String(scope.codes?.[0] ?? "").trim().toUpperCase();
  if (!loginCode || loginCode === "*") return null;
  if (memory) return { loginCode };
  return { loginCode, pendingSchoolLookup: true };
}

async function lookupSchoolIdByLoginCode(loginCode, one) {
  if (typeof one !== "function") return null;
  const row = await one(
    `SELECT id
     FROM schools
     WHERE upper(btrim(login_code)) = $1
     LIMIT 1`,
    [loginCode],
  );
  const schoolId = String(row?.id ?? "").trim();
  return isUuid(schoolId) ? { schoolId } : null;
}

async function resolvePedagogyProjectionScope(principal, { one, memory = false } = {}) {
  if (!principal) return null;
  const attached = memory || typeof one !== "function"
    ? attachPresenceFixtureScope(principal)
    : await attachPresenceMembershipScope(principal, one);
  return pedagogyScopeFromResolved(resolvePresenceSchoolScope(attached), { memory });
}

async function resolveFinanceProjectionScope(principal, { one, memory = false } = {}) {
  if (!principal) return null;
  const attached = memory || typeof one !== "function"
    ? attachFinanceFixtureScope(principal)
    : await attachFinanceMembershipScope(principal, one);
  const scope = financeScopeFromResolved(resolveFinanceSchoolScope(attached), { memory });
  if (scope?.pendingSchoolLookup) {
    return lookupSchoolIdByLoginCode(scope.loginCode, one);
  }
  return scope;
}

module.exports = {
  resolvePedagogyProjectionScope,
  resolveFinanceProjectionScope,
  pedagogyScopeFromResolved,
  financeScopeFromResolved,
};
