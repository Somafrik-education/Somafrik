"use strict";

/**
 * Identité et clés de rôle canoniques actives relues en base pour l'établissement de la session.
 * Le JWT n'est qu'une identité : un rôle révoqué ou présent dans le seul jeton ne compte pas.
 * Fail-closed : sans primitive de lecture des rôles, aucune clé n'est retenue.
 */
async function liveSchoolActor(repo, principal, schoolId) {
  let userId = String(principal?.sub ?? principal?.id ?? "").trim();
  if (!userId || !schoolId || typeof repo.listActiveUserRoleKeysForSchool !== "function") {
    return { userId, roleKeys: [] };
  }
  if (typeof repo.resolveCanonicalUserIdForSchool === "function") {
    const canonical = await repo.resolveCanonicalUserIdForSchool(userId, schoolId);
    if (canonical) userId = String(canonical).trim();
  }
  const loaded = await repo.listActiveUserRoleKeysForSchool(userId, schoolId);
  const roleKeys = Array.isArray(loaded)
    ? [...new Set(loaded.map((key) => String(key ?? "").trim().toUpperCase()).filter(Boolean))].sort()
    : [];
  return { userId, roleKeys };
}

module.exports = { liveSchoolActor };
