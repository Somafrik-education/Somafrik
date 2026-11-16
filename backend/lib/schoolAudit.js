"use strict";

/**
 * ADMIN-06C — journal d’audit établissement school-only.
 * JWT école uniquement. Projection DTO, jamais old/new/IP/userAgent.
 */

const { BusinessError } = require("../services/authService");
const { isPlatformAdminPrincipal } = require("./platformPersonalDataGuard");
const { isSuperAdminPrincipal } = require("./superadminPrincipal");

const AUDIT_ERROR = Object.freeze({
  FORBIDDEN: "FORBIDDEN",
});

const SCHOOL_ADMIN_ROLE_LABELS = Object.freeze(["Admin School"]);
const SCHOOL_ADMIN_ROLE_KEYS = Object.freeze(["SCHOOL_ADMIN"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function isCountryAdminPrincipal(principal) {
  return asTrimmed(principal?.role) === "Admin Pays";
}

function pushRoleToken(tokens, value) {
  if (value == null) return;
  if (typeof value === "string" || typeof value === "number") {
    tokens.push(asTrimmed(value));
  }
}

function collectPrincipalRoleTokens(principal) {
  const tokens = [];
  pushRoleToken(tokens, principal?.role);
  pushRoleToken(tokens, principal?.roleKey);
  pushRoleToken(tokens, principal?.role_key);
  if (Array.isArray(principal?.roleKeys)) {
    for (const item of principal.roleKeys) pushRoleToken(tokens, item);
  }
  return tokens.filter(Boolean);
}

function isSchoolAdminPrincipal(principal) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal)) return false;
  return collectPrincipalRoleTokens(principal).some((token) => {
    if (SCHOOL_ADMIN_ROLE_LABELS.includes(token)) return true;
    return SCHOOL_ADMIN_ROLE_KEYS.includes(token.toUpperCase());
  });
}

function hasConcreteSchoolScope(principal) {
  const schoolCode = asTrimmed(principal?.schoolCode).toUpperCase();
  return Boolean(schoolCode) && schoolCode !== "*";
}

function hasExplicitAuditRead(principal) {
  const permissions = Array.isArray(principal?.permissions) ? principal.permissions : [];
  return permissions.includes("Audit:READ");
}

function schoolAuditForbidden(message = "Accès refusé au journal d’audit.") {
  const error = new BusinessError(403, message);
  error.code = AUDIT_ERROR.FORBIDDEN;
  return error;
}

function assertSchoolAuditRead(principal) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal)) {
    throw schoolAuditForbidden();
  }
  if (isPlatformAdminPrincipal(principal) || isSuperAdminPrincipal(principal) || isCountryAdminPrincipal(principal)) {
    throw schoolAuditForbidden();
  }
  if (!isSchoolAdminPrincipal(principal)) {
    throw schoolAuditForbidden();
  }
  if (!hasConcreteSchoolScope(principal)) {
    throw schoolAuditForbidden();
  }
  if (!hasExplicitAuditRead(principal)) {
    throw schoolAuditForbidden();
  }
}

function resolveSchoolAuditScope(principal) {
  assertSchoolAuditRead(principal);
  return asTrimmed(principal.schoolCode).toUpperCase();
}

function clampLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function clampOffset(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function sanitizeAuditFilters(filters = {}) {
  return {
    action: asTrimmed(filters.action) || undefined,
    entityType: asTrimmed(filters.entityType) || undefined,
    from: asTrimmed(filters.from) || undefined,
    to: asTrimmed(filters.to) || undefined,
    limit: clampLimit(filters.limit),
    offset: clampOffset(filters.offset),
  };
}

function displayActor(row) {
  const named = [row.actorFirstName, row.actorLastName, row.first_name, row.last_name]
    .map((value) => asTrimmed(value))
    .filter(Boolean)
    .join(" ");
  if (named) return named;
  const actor = asTrimmed(row.actor);
  if (!actor || actor === "system" || actor === "Système") return "Système";
  if (actor === asTrimmed(row.userId) || actor === asTrimmed(row.userCode)) return "Système";
  if (/@|password|pin|token|jwt/i.test(actor)) return "Système";
  return actor;
}

function projectAuditSummary(row) {
  return {
    id: String(row?.id ?? ""),
    action: String(row?.action ?? ""),
    entityType: String(row?.entityType ?? row?.entity_type ?? ""),
    entityId: row?.entityId ?? row?.entity_id ?? null,
    actor: displayActor(row ?? {}),
    createdAt: row?.createdAt ?? row?.created_at ?? null,
  };
}

async function listSchoolAuditSummaries(repository, principal, filters = {}) {
  const schoolCode = resolveSchoolAuditScope(principal);
  const query = sanitizeAuditFilters(filters);
  if (typeof repository?.listSchoolAuditSummaries !== "function") {
    throw new BusinessError(500, "Journal d’audit indisponible.");
  }
  const rows = await repository.listSchoolAuditSummaries({ schoolCode, ...query });
  return (Array.isArray(rows) ? rows : []).map(projectAuditSummary);
}

module.exports = {
  AUDIT_ERROR,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  assertSchoolAuditRead,
  listSchoolAuditSummaries,
  projectAuditSummary,
  sanitizeAuditFilters,
  resolveSchoolAuditScope,
  isSchoolAdminPrincipal,
};
