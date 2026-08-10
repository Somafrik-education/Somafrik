import { createTenantScope } from "../../domain/src/index.js";

import { isCanonicalRole } from "./roles.js";

function isExactPermissionToken(permission) {
  return typeof permission === "string" && permission.trim() !== "";
}

function hasValidPermissionEntries(permissions) {
  if (!Array.isArray(permissions)) {
    return false;
  }

  return permissions.every((permission) => isExactPermissionToken(permission));
}

function hasValidTenantScope(tenantScope) {
  try {
    createTenantScope(tenantScope);
    return true;
  } catch {
    return false;
  }
}

function isUsablePrincipal(principal) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal)) {
    return false;
  }

  if (typeof principal.userId !== "string" || principal.userId.trim() === "") {
    return false;
  }

  if (!isCanonicalRole(principal.role)) {
    return false;
  }

  if (!hasValidTenantScope(principal.tenantScope)) {
    return false;
  }

  if (!hasValidPermissionEntries(principal.permissions)) {
    return false;
  }

  return true;
}

export function can(principal, permission) {
  if (!isExactPermissionToken(permission)) {
    return false;
  }

  if (!isUsablePrincipal(principal)) {
    return false;
  }

  return principal.permissions.includes(permission);
}
