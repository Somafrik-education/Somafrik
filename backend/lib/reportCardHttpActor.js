"use strict";

const { isInternalSchoolAlias, isV2SchoolLoginCode } = require("./schoolCodeV2");

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function principalPermissionList(principal) {
  if (!principal) return [];
  if (Array.isArray(principal.permissions)) return principal.permissions;
  if (Array.isArray(principal.effectivePermissions)) return principal.effectivePermissions;
  return [];
}

function hasFeatureAction(principal, feature, action) {
  const list = principalPermissionList(principal);
  if (list.includes("ALL_PRIVILEGES")) return true;
  return list.includes(`${feature}:${action}`);
}

function isSchoolUuid(value) {
  return UUID_RE.test(String(value || "").trim());
}

function schoolRecordId(school) {
  if (!school || typeof school !== "object") return "";
  const id = String(school.id || school.schoolId || school.school_id || "").trim();
  if (!id || id === "*") return "";
  if (isV2SchoolLoginCode(id) || isInternalSchoolAlias(id)) return "";
  return id;
}

function tenantSchoolIdFromPrincipal(principal) {
  if (!principal) return "";
  for (const value of [principal.effectiveSchoolId, principal.schoolId, principal.school_id]) {
    const text = String(value || "").trim();
    if (isSchoolUuid(text)) return text;
  }
  const explicit = String(principal.schoolId || principal.school_id || "").trim();
  if (
    explicit &&
    !isV2SchoolLoginCode(explicit) &&
    !isInternalSchoolAlias(explicit) &&
    explicit !== "*"
  ) {
    return explicit;
  }
  return "";
}

function resolveReportCardActorFromPrincipal(principal) {
  if (!principal) return null;
  const actorId = principal.sub || principal.id || principal.userId;
  if (SUPER_ADMIN_ROLES.has(principal.role)) {
    return {
      actorId,
      permissions: ["REPORT_CARD_CONFIGURE"],
      platform: { privileged: true },
    };
  }
  const permissions = [];
  if (hasFeatureAction(principal, "Bulletins", "CREATE")) {
    permissions.push("REPORT_CARD_SUBMIT_MODEL");
  }
  if (hasFeatureAction(principal, "Bulletins", "UPDATE")) {
    permissions.push("REPORT_CARD_SCHOOL_APPROVE_TEMPLATE");
  }
  return {
    actorId,
    actorSchoolId: tenantSchoolIdFromPrincipal(principal),
    permissions,
  };
}

async function resolveReportCardTenantSchoolId(raw, lookupSchool) {
  const text = String(raw || "").trim();
  if (!text || text === "*") return "";
  if (isSchoolUuid(text)) return text;
  if (!isV2SchoolLoginCode(text) && !isInternalSchoolAlias(text)) {
    return text;
  }
  if (typeof lookupSchool !== "function") return "";
  const school = await lookupSchool(text);
  return schoolRecordId(school);
}

async function resolveReportCardActor(principal, lookupSchool) {
  const actor = resolveReportCardActorFromPrincipal(principal);
  if (!actor || actor.platform?.privileged) return actor;
  if (actor.actorSchoolId) return actor;
  const code = String(principal?.effectiveSchoolCode || principal?.schoolCode || "").trim();
  const resolved = await resolveReportCardTenantSchoolId(code, lookupSchool);
  return { ...actor, actorSchoolId: resolved };
}

module.exports = {
  resolveReportCardActorFromPrincipal,
  resolveReportCardActor,
  resolveReportCardTenantSchoolId,
};
