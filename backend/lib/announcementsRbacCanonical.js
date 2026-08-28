"use strict";

/**
 * COM-C3 — backfill contrôlé Announcements depuis Notifications.
 * Ne hardcode pas de noms de rôles métier. Recopie les grants existants
 * Notifications → Announcements si le grant announcements est absent.
 * can_delete reste FALSE (pas de suppression physique).
 */

const ANNOUNCEMENTS_RBAC_UPDATED_BY = "bootstrap-c3-announcements";

const PLATFORM_ROLE_KEYS = Object.freeze([
  "SUPER_ADMIN",
  "COUNTRY_ADMIN",
  "SCHOOL_ADMIN",
  "TEACHER",
  "PARENT",
  "STUDENT",
  "SECRETARY",
  "PREFET_ETUDES",
  "ACCOUNTANT",
  "DIRECTOR",
]);

function toRoleKeySafe(value) {
  try {
    const { toRoleKey } = require("./userRoleLifecycle");
    return String(toRoleKey(value) || "").toUpperCase();
  } catch {
    return String(value ?? "")
      .trim()
      .toUpperCase();
  }
}

async function collectRoleKeys(store, repo) {
  const keys = new Set(PLATFORM_ROLE_KEYS);
  if (typeof store.listGrantsForRoles === "function") {
    /* grants connus via rôles plateforme ci-dessus */
  }
  if (typeof repo?.listEstablishmentRoles === "function") {
    try {
      const roles = await repo.listEstablishmentRoles({});
      for (const role of roles ?? []) {
        const key = toRoleKeySafe(role.roleCode || role.role_code || role.roleKey || role.role_key);
        if (key) keys.add(key);
      }
    } catch {
      /* catalogue indisponible : on continue avec les clés plateforme */
    }
  }
  if (typeof repo?.getEstablishmentRolesStore === "function") {
    try {
      const rolesStore = repo.getEstablishmentRolesStore();
      const listed =
        typeof rolesStore.listRoles === "function"
          ? await rolesStore.listRoles({})
          : typeof rolesStore.list === "function"
            ? await rolesStore.list()
            : [];
      for (const role of listed ?? []) {
        const key = toRoleKeySafe(role.roleCode || role.role_code || role.roleKey || role.role_key);
        if (key) keys.add(key);
      }
    } catch {
      /* ignore */
    }
  }
  return [...keys].filter(Boolean);
}

async function reconcileCanonicalAnnouncementsGrants(store, repo) {
  if (!store || typeof store.listGrantsForRoles !== "function" || typeof store.upsertGrant !== "function") {
    return 0;
  }
  const roleKeys = await collectRoleKeys(store, repo);
  let changed = 0;
  for (const roleKey of roleKeys) {
    const grants = await store.listGrantsForRoles([roleKey]);
    const buckets = new Map();
    for (const grant of grants) {
      const scopeKey = `${grant.scopeType}|${grant.countryId || ""}|${grant.schoolId || ""}`;
      if (!buckets.has(scopeKey)) {
        buckets.set(scopeKey, { scope: grant, modules: new Map() });
      }
      buckets.get(scopeKey).modules.set(grant.moduleKey, grant);
    }
    for (const { scope, modules } of buckets.values()) {
      if (modules.has("announcements")) continue;
      const notifications = modules.get("notifications");
      if (!notifications) continue;
      if (!notifications.canCreate && !notifications.canRead && !notifications.canUpdate) continue;
      await store.upsertGrant({
        roleKey,
        scopeType: scope.scopeType,
        countryId: scope.countryId,
        schoolId: scope.schoolId,
        moduleKey: "announcements",
        canCreate: Boolean(notifications.canCreate),
        canRead: Boolean(notifications.canRead),
        canUpdate: Boolean(notifications.canUpdate),
        canDelete: false,
        updatedBy: ANNOUNCEMENTS_RBAC_UPDATED_BY,
      });
      changed += 1;
    }
  }
  return changed;
}

module.exports = {
  ANNOUNCEMENTS_RBAC_UPDATED_BY,
  reconcileCanonicalAnnouncementsGrants,
};
