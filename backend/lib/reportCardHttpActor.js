"use strict";

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);

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
  if (hasFeatureAction(principal, "Bulletins", "CREATE") || hasFeatureAction(principal, "Bulletins", "READ")) {
    permissions.push("REPORT_CARD_SUBMIT_MODEL");
  }
  if (hasFeatureAction(principal, "Bulletins", "UPDATE")) {
    permissions.push("REPORT_CARD_SCHOOL_APPROVE_TEMPLATE");
  }
  if (principal.role === "Admin School") {
    if (!permissions.includes("REPORT_CARD_SUBMIT_MODEL")) permissions.push("REPORT_CARD_SUBMIT_MODEL");
    if (!permissions.includes("REPORT_CARD_SCHOOL_APPROVE_TEMPLATE")) {
      permissions.push("REPORT_CARD_SCHOOL_APPROVE_TEMPLATE");
    }
  }
  return {
    actorId,
    actorSchoolId: principal.schoolId || principal.schoolCode,
    permissions,
  };
}

module.exports = { resolveReportCardActorFromPrincipal };
