"use strict";

/**
 * PERF-PR1 — périmètre SQL des projections pédagogie et finance.
 * Aucune valeur n'est concaténée : school_id et le code pays sont des paramètres.
 * Sans périmètre explicite, la lecture est refusée (pas de projection globale par défaut).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function projectionScopeError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 403;
  return error;
}

function injectPredicate(sql, predicate) {
  let depth = 0;
  let orderAt = -1;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && /^order\s+by\b/i.test(sql.slice(index))) orderAt = index;
  }
  const head = orderAt === -1 ? sql : sql.slice(0, orderAt);
  const tail = orderAt === -1 ? "" : sql.slice(orderAt);
  depth = 0;
  let topWhere = false;
  for (let index = 0; index < head.length; index += 1) {
    const char = head[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && /^where\b/i.test(head.slice(index))) topWhere = true;
  }
  const glue = topWhere ? `AND (${predicate})` : `WHERE (${predicate})`;
  const trimmedHead = head.replace(/\s+$/, "");
  const trimmedTail = tail.replace(/^\s+/, "");
  return trimmedTail ? `${trimmedHead}\n${glue}\n${trimmedTail}` : `${trimmedHead}\n${glue}`;
}

function schoolColumn(alias) {
  return alias ? `${alias}.school_id` : "school_id";
}

/**
 * @param {string} sql
 * @param {string} alias alias SQL figé dans le code, jamais une entrée client
 * @param {{ platform?: boolean, schoolId?: string, countryCode?: string } | null | undefined} scope
 * @param {{ includeGlobalCatalog?: boolean }} [options]
 * includeGlobalCatalog conserve les lignes school_id NULL (catalogue partagé).
 * Une ligne d'un autre établissement, school_id renseigné, reste exclue.
 */
function projectionQuery(sql, alias, scope, options = {}) {
  const column = schoolColumn(alias);
  const withCatalog = (predicate) =>
    options.includeGlobalCatalog === true ? `(${column} IS NULL OR ${predicate})` : predicate;
  if (scope?.platform === true) return { text: sql, params: [] };
  if (scope?.countryCode) {
    const country = String(scope.countryCode).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) {
      throw projectionScopeError("PROJECTION_SCOPE_INVALID", "Pays de projection invalide.");
    }
    const predicate = `EXISTS (
      SELECT 1 FROM schools _perf_s
      JOIN countries _perf_c ON _perf_c.id = _perf_s.country_id
      WHERE _perf_s.id = ${column}
        AND upper(btrim(_perf_c.iso_code)) = $1
    )`;
    return { text: injectPredicate(sql, withCatalog(predicate)), params: [country] };
  }
  const schoolId = String(scope?.schoolId ?? "").trim();
  if (!UUID_RE.test(schoolId)) {
    throw projectionScopeError(
      schoolId ? "PROJECTION_SCHOOL_INVALID" : "PROJECTION_SCHOOL_REQUIRED",
      "Établissement requis pour la projection.",
    );
  }
  return {
    text: injectPredicate(sql, withCatalog(`${column} = $1::uuid`)),
    params: [schoolId],
  };
}

function hasProjectionScope(scope) {
  return Boolean(
    scope?.platform === true ||
      scope?.schoolId ||
      scope?.loginCode ||
      scope?.countryCode,
  );
}

function rowMatchesProjectionScope(row, scope) {
  if (!hasProjectionScope(scope)) return false;
  if (scope.platform === true) return true;
  if (scope.schoolId) {
    const rowId = String(row?.schoolId ?? row?.school_id ?? "").trim().toLowerCase();
    return Boolean(rowId) && rowId === String(scope.schoolId).trim().toLowerCase();
  }
  if (scope.loginCode) {
    const wanted = String(scope.loginCode).trim().toUpperCase();
    const codes = [row?.schoolCode, row?.loginCode, row?.schoolLoginCode, row?.code, row?.login_code]
      .map((value) => String(value ?? "").trim().toUpperCase())
      .filter(Boolean);
    return codes.includes(wanted);
  }
  if (scope.countryCode) {
    const country = String(scope.countryCode).trim().toUpperCase();
    const explicit = String(row?.countryCode ?? row?.countryIso ?? row?.country_iso ?? "")
      .trim()
      .toUpperCase();
    if (/^[A-Z]{2}$/.test(explicit)) return explicit === country;
    const prefix = String(row?.schoolCode ?? "").trim().toUpperCase().slice(0, 2);
    return prefix === country;
  }
  return false;
}

function isSharedPaymentCatalog(key, row) {
  if (key !== "paymentStatuses") return false;
  const schoolId = String(row?.schoolId ?? row?.school_id ?? "").trim();
  const schoolCode = String(
    row?.schoolCode ?? row?.loginCode ?? row?.school_code ?? row?.login_code ?? "",
  ).trim();
  return !schoolId && !schoolCode;
}

function filterProjectionRecord(record, scope) {
  const source = record && typeof record === "object" ? record : {};
  if (scope?.platform === true) return source;
  const next = {};
  for (const [key, value] of Object.entries(source)) {
    next[key] = Array.isArray(value)
      ? value.filter((row) => isSharedPaymentCatalog(key, row) || rowMatchesProjectionScope(row, scope))
      : value;
  }
  return next;
}

function emptyPedagogyProjection() {
  return { courses: [], courseSchedules: [], evaluations: [], notes: [], presences: [] };
}

function emptyFinanceProjection() {
  return {
    payments: [],
    paymentStatuses: [],
    feeGrids: [],
    schoolFeeItems: [],
    studentFees: [],
    feeTariffHistory: [],
    paymentReminders: [],
  };
}

module.exports = {
  injectPredicate,
  projectionQuery,
  projectionScopeError,
  hasProjectionScope,
  rowMatchesProjectionScope,
  filterProjectionRecord,
  emptyPedagogyProjection,
  emptyFinanceProjection,
};
