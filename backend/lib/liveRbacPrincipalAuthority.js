"use strict";

const { resolveEffectivePermissionsForPrincipal } = require("./functionalRbacService");

const LIVE_RBAC_EMPTY_ROLE = "SANS_AFFECTATION";

function trim(value) {
  return String(value ?? "").trim();
}

async function listAuthoritativeRoleKeys(repository, principal) {
  const rawUserId = trim(principal?.sub || principal?.id);
  if (!rawUserId) return [];

  const schoolCode = trim(principal?.schoolCode).toUpperCase();
  if (schoolCode && schoolCode !== "*") {
    if (
      typeof repository.getSchoolByCode === "function" &&
      typeof repository.listActiveUserRoleKeysForSchool === "function"
    ) {
      const school = await repository.getSchoolByCode(schoolCode);
      if (!school?.id) return [];
      // JWT = identité : sub peut être users.id ou overlay teachers.id du tenant.
      // Ce n'est pas un fallback de rôles/permissions JWT.
      let userId = rawUserId;
      if (typeof repository.resolveCanonicalUserIdForSchool === "function") {
        const canonical = await repository.resolveCanonicalUserIdForSchool(rawUserId, school.id);
        if (canonical) userId = trim(canonical);
      }
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
  const loaded = await repository.listActiveUserRoleKeys(rawUserId);
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

  Object.defineProperty(repository, "__liveRbacAuthorityAttached", {
    value: true,
    enumerable: false,
    configurable: false,
  });
  // F6 strict : primitive dédiée. Ne pas remplacer resolveEffectivePermissions —
  // L1 / Classes / Présences / Notes conservent leur contrat live existant
  // (handler fail-closed, HTTP 200 items []).
  repository.resolveFinanceLivePermissions = (principal) =>
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
