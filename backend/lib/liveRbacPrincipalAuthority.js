"use strict";

const { resolveEffectivePermissionsForPrincipal } = require("./functionalRbacService");

const LIVE_RBAC_EMPTY_ROLE = "SANS_AFFECTATION";

function trim(value) {
  return String(value ?? "").trim();
}

async function listAuthoritativeRoleKeys(repository, principal) {
  const userId = trim(principal?.sub || principal?.id);
  if (!userId) return [];

  const schoolCode = trim(principal?.schoolCode).toUpperCase();
  if (schoolCode && schoolCode !== "*") {
    if (
      typeof repository.getSchoolByCode === "function" &&
      typeof repository.listActiveUserRoleKeysForSchool === "function"
    ) {
      const school = await repository.getSchoolByCode(schoolCode);
      if (!school?.id) return [];
      const scoped = await repository.listActiveUserRoleKeysForSchool(userId, school.id);
      if (!Array.isArray(scoped)) {
        throw new Error("LIVE_RBAC_ROLE_LOOKUP_INVALID");
      }
      return scoped;
    }
    // Une session établissement sans primitive de lookup tenant-scoped ne peut pas
    // retomber sur les claims JWT : fail-closed.
    return [];
  }

  if (typeof repository.listActiveUserRoleKeys !== "function") return [];
  const loaded = await repository.listActiveUserRoleKeys(userId);
  if (!Array.isArray(loaded)) {
    throw new Error("LIVE_RBAC_ROLE_LOOKUP_INVALID");
  }
  return loaded;
}

function repositoryWithAuthoritativeRoleKeys(repository, roleKeys) {
  const authoritative = roleKeys.length ? [...roleKeys] : [LIVE_RBAC_EMPTY_ROLE];
  return new Proxy(repository, {
    get(target, prop, receiver) {
      if (prop === "listActiveUserRoleKeys") {
        return async () => [...authoritative];
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") return value.bind(target);
      return value;
    },
  });
}

function failClosedLegacyResolution(resolved, roleKeys) {
  const source = trim(resolved?.source);
  if (source && !source.includes("legacy")) return resolved;
  return {
    roleKeys: [...roleKeys],
    permissions: [],
    modules: {},
    source: source ? `${source}:fail-closed-live-rbac` : "fail-closed-live-rbac",
    resolvedAt: new Date().toISOString(),
  };
}

async function resolveLiveEffectivePermissions(repository, principal) {
  const roleKeys = await listAuthoritativeRoleKeys(repository, principal);
  const scopedRepository = repositoryWithAuthoritativeRoleKeys(repository, roleKeys);
  const resolved = await resolveEffectivePermissionsForPrincipal(scopedRepository, principal);
  return failClosedLegacyResolution(resolved, roleKeys);
}

function attachLiveRbacAuthority(repository) {
  if (!repository || repository.__liveRbacAuthorityAttached) return repository;
  if (typeof repository.resolveEffectivePermissions !== "function") return repository;

  Object.defineProperty(repository, "__liveRbacAuthorityAttached", {
    value: true,
    enumerable: false,
    configurable: false,
  });
  repository.resolveEffectivePermissions = (principal) =>
    resolveLiveEffectivePermissions(repository, principal);
  return repository;
}

module.exports = {
  LIVE_RBAC_EMPTY_ROLE,
  listAuthoritativeRoleKeys,
  repositoryWithAuthoritativeRoleKeys,
  failClosedLegacyResolution,
  resolveLiveEffectivePermissions,
  attachLiveRbacAuthority,
};
