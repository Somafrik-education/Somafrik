"use strict";

const { randomUUID } = require("node:crypto");
const { listFunctionalModules } = require("../lib/functionalModulesCatalog");
const { asTrimmed } = require("../lib/establishmentRolesManagement");
const { nextMonotonicUpdatedAt } = require("../lib/functionalRbacManagement");
const { mapGrantRow } = require("./functionalRbacPgStore");

function createFunctionalRbacMemoryStore(seed = {}) {
  const modules = listFunctionalModules().map((row) => ({ ...row, status: "active" }));
  const grants = [];
  const rolesUsage = [...(seed.roles ?? [])];

  function matchesScope(row, { roleKey, scopeType, countryId, schoolId }) {
    if (String(row.role_key).toUpperCase() !== String(roleKey).toUpperCase()) return false;
    if (row.scope_type !== scopeType) return false;
    if (scopeType === "school") {
      return String(row.school_id || "") === String(schoolId || "");
    }
    if (scopeType === "country") {
      return String(row.country_id || "") === String(countryId || "") && !row.school_id;
    }
    return !row.country_id && !row.school_id;
  }

  return {
    async seedFunctionalModules() {
      return true;
    },
    async listModules() {
      return modules.map((row) => ({
        moduleKey: row.moduleKey,
        moduleName: row.moduleName,
        appliesWeb: row.appliesWeb,
        appliesMobile: row.appliesMobile,
        status: "active",
        displayOrder: row.displayOrder,
      }));
    },
    async listGrantsForRoles(roleKeys = []) {
      const keys = new Set(roleKeys.map((key) => String(key || "").toUpperCase()).filter(Boolean));
      return grants.filter((row) => row.status === "active" && keys.has(String(row.role_key).toUpperCase())).map(mapGrantRow);
    },
    async listGrantsForScope({ roleKey, scopeType, countryId, schoolId }) {
      return grants
        .filter((row) => row.status === "active" && matchesScope(row, { roleKey, scopeType, countryId, schoolId }))
        .map(mapGrantRow);
    },
    async maxUpdatedAtForScope({ roleKey, scopeType, countryId, schoolId }) {
      const scoped = grants.filter(
        (row) => row.status === "active" && matchesScope(row, { roleKey, scopeType, countryId, schoolId }),
      );
      if (!scoped.length) return null;
      return scoped.reduce((max, row) => (row.updated_at > max ? row.updated_at : max), scoped[0].updated_at);
    },
    async countActiveGrants() {
      return grants.filter((row) => row.status === "active").length;
    },
    async upsertGrant(input) {
      const actor = asTrimmed(input.updatedBy) || null;
      const roleKey = String(input.roleKey).toUpperCase();
      const index = grants.findIndex(
        (row) =>
          row.status === "active" &&
          matchesScope(row, {
            roleKey,
            scopeType: input.scopeType,
            countryId: input.countryId,
            schoolId: input.schoolId,
          }) &&
          row.module_key === input.moduleKey,
      );
      const now = nextMonotonicUpdatedAt(index >= 0 ? grants[index].updated_at : null);
      if (index >= 0) {
        grants[index] = {
          ...grants[index],
          can_create: Boolean(input.canCreate),
          can_read: Boolean(input.canRead),
          can_update: Boolean(input.canUpdate),
          can_delete: Boolean(input.canDelete),
          version: Number(grants[index].version ?? 1) + 1,
          updated_by: actor,
          updated_at: now,
        };
        return mapGrantRow(grants[index]);
      }
      const row = {
        id: randomUUID(),
        role_key: roleKey,
        scope_type: input.scopeType,
        country_id: input.countryId || null,
        school_id: input.schoolId || null,
        module_key: input.moduleKey,
        can_create: Boolean(input.canCreate),
        can_read: Boolean(input.canRead),
        can_update: Boolean(input.canUpdate),
        can_delete: Boolean(input.canDelete),
        status: "active",
        version: 1,
        created_at: now,
        created_by: actor,
        updated_at: now,
        updated_by: actor,
      };
      grants.push(row);
      return mapGrantRow(row);
    },
    async resolveCountryAndSchool({ countryCode, schoolCode, countryId, schoolId }) {
      const resolve = seed.resolveCountryAndSchool;
      if (typeof resolve === "function") {
        return resolve({ countryCode, schoolCode, countryId, schoolId });
      }
      const school = schoolId || schoolCode
        ? {
            id: schoolId || `school-${String(schoolCode).toUpperCase()}`,
            school_code: schoolCode || schoolId,
            country_id: countryId || "country-cd",
            country_code: countryCode || String(schoolCode || "CD").slice(0, 2).toUpperCase(),
          }
        : null;
      const country = countryId || countryCode || school
        ? {
            id: countryId || school?.country_id || `country-${String(countryCode || "CD").toUpperCase()}`,
            code: countryCode || school?.country_code || "CD",
          }
        : null;
      return { country, school };
    },
    async listRolesWithUsage({ includeArchived = true } = {}) {
      return rolesUsage.filter((row) => includeArchived || row.status === "active");
    },
    async markSystemProtected() {
      return true;
    },
  };
}

module.exports = {
  createFunctionalRbacMemoryStore,
};
