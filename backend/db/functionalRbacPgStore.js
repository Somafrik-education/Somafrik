"use strict";

const { listFunctionalModules } = require("../lib/functionalModulesCatalog");
const { asTrimmed } = require("../lib/establishmentRolesManagement");
const { looksLikeUuid } = require("../lib/functionalRbacManagement");

function mapGrantRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    roleKey: row.role_key,
    scopeType: row.scope_type,
    countryId: row.country_id || null,
    schoolId: row.school_id || null,
    moduleKey: row.module_key,
    canCreate: Boolean(row.can_create),
    canRead: Boolean(row.can_read),
    canUpdate: Boolean(row.can_update),
    canDelete: Boolean(row.can_delete),
    status: row.status === "archived" ? "archived" : "active",
    version: Number(row.version ?? 1),
    createdAt: row.created_at,
    createdBy: row.created_by || null,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || null,
  };
}

function createFunctionalRbacPgStore(repo) {
  const one = (...args) => repo.one(...args);
  const all = (...args) => repo.all(...args);
  const query = (...args) => repo.query(...args);

  async function seedFunctionalModules() {
    for (const module of listFunctionalModules()) {
      await query(
        `INSERT INTO functional_modules (module_key, module_name, applies_web, applies_mobile, display_order, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (module_key) DO UPDATE SET
           module_name = EXCLUDED.module_name,
           applies_web = EXCLUDED.applies_web,
           applies_mobile = EXCLUDED.applies_mobile,
           display_order = EXCLUDED.display_order,
           updated_at = NOW()`,
        [module.moduleKey, module.moduleName, module.appliesWeb, module.appliesMobile, module.displayOrder],
      );
    }
  }

  async function listModules() {
    const rows = await all(
      `SELECT * FROM functional_modules WHERE status = 'active' ORDER BY display_order, module_name`,
    );
    return rows.map((row) => ({
      moduleKey: row.module_key,
      moduleName: row.module_name,
      appliesWeb: Boolean(row.applies_web),
      appliesMobile: Boolean(row.applies_mobile),
      status: row.status,
      displayOrder: Number(row.display_order ?? 0),
    }));
  }

  async function listGrantsForRoles(roleKeys = []) {
    const keys = [...new Set(roleKeys.map((key) => String(key || "").toUpperCase()).filter(Boolean))];
    if (!keys.length) return [];
    const rows = await all(
      `SELECT * FROM role_module_permissions
       WHERE status = 'active' AND upper(role_key) = ANY($1::text[])`,
      [keys],
    );
    return rows.map(mapGrantRow);
  }

  async function listGrantsForScope({ roleKey, scopeType, countryId, schoolId }) {
    const rows = await all(
      `SELECT * FROM role_module_permissions
       WHERE status = 'active'
         AND upper(role_key) = upper($1)
         AND scope_type = $2
         AND country_id IS NOT DISTINCT FROM $3::uuid
         AND school_id IS NOT DISTINCT FROM $4::uuid
       ORDER BY module_key`,
      [roleKey, scopeType, countryId, schoolId],
    );
    return rows.map(mapGrantRow);
  }

  async function maxUpdatedAtForScope({ roleKey, scopeType, countryId, schoolId }) {
    const row = await one(
      `SELECT MAX(updated_at) AS updated_at
       FROM role_module_permissions
       WHERE status = 'active'
         AND upper(role_key) = upper($1)
         AND scope_type = $2
         AND country_id IS NOT DISTINCT FROM $3::uuid
         AND school_id IS NOT DISTINCT FROM $4::uuid`,
      [roleKey, scopeType, countryId, schoolId],
    );
    return row?.updated_at || null;
  }

  async function countActiveGrants() {
    const row = await one(`SELECT COUNT(*)::int AS count FROM role_module_permissions WHERE status = 'active'`);
    return Number(row?.count ?? 0);
  }

  async function upsertGrant(input) {
    const actor = asTrimmed(input.updatedBy) || null;
    const roleKey = String(input.roleKey).toUpperCase();
    const existing = await one(
      `SELECT id FROM role_module_permissions
       WHERE status = 'active'
         AND upper(role_key) = $1
         AND scope_type = $2
         AND module_key = $3
         AND country_id IS NOT DISTINCT FROM $4::uuid
         AND school_id IS NOT DISTINCT FROM $5::uuid
       LIMIT 1`,
      [roleKey, input.scopeType, input.moduleKey, input.countryId, input.schoolId],
    );
    const row = existing
      ? await one(
          `UPDATE role_module_permissions
           SET can_create = $2, can_read = $3, can_update = $4, can_delete = $5,
               version = version + 1, updated_by = $6, updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [
            existing.id,
            Boolean(input.canCreate),
            Boolean(input.canRead),
            Boolean(input.canUpdate),
            Boolean(input.canDelete),
            actor,
          ],
        )
      : await one(
          `INSERT INTO role_module_permissions (
             role_key, scope_type, country_id, school_id, module_key,
             can_create, can_read, can_update, can_delete, status, version,
             created_by, updated_by, created_at, updated_at
           )
           VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, 'active', 1, $10, $10, NOW(), NOW())
           RETURNING *`,
          [
            roleKey,
            input.scopeType,
            input.countryId,
            input.schoolId,
            input.moduleKey,
            Boolean(input.canCreate),
            Boolean(input.canRead),
            Boolean(input.canUpdate),
            Boolean(input.canDelete),
            actor,
          ],
        );
    return mapGrantRow(row);
  }

  async function resolveCountryAndSchool({ countryCode, schoolCode, countryId, schoolId }) {
    let country = null;
    let school = null;
    const schoolUuid = looksLikeUuid(schoolId) ? schoolId : null;
    const schoolCodeLookup = asTrimmed(schoolCode) || (!schoolUuid ? asTrimmed(schoolId) : "");
    if (schoolUuid) {
      school = await one(
        `SELECT s.id, s.school_code, s.country_id, c.iso_code AS country_code
         FROM schools s JOIN countries c ON c.id = s.country_id
         WHERE s.id = $1::uuid`,
        [schoolUuid],
      );
    }
    if (!school && schoolCodeLookup) {
      school = await one(
        `SELECT s.id, s.school_code, s.country_id, c.iso_code AS country_code
         FROM schools s JOIN countries c ON c.id = s.country_id
         WHERE upper(s.school_code) = upper($1)`,
        [schoolCodeLookup],
      );
    }
    if (school) {
      country = {
        id: school.country_id,
        code: school.country_code,
      };
      return { country, school };
    }
    const countryUuid = looksLikeUuid(countryId) ? countryId : null;
    const countryCodeLookup = asTrimmed(countryCode) || (!countryUuid ? asTrimmed(countryId) : "");
    if (countryUuid) {
      country = await one(`SELECT id, iso_code AS code FROM countries WHERE id = $1::uuid`, [countryUuid]);
    }
    if (!country && countryCodeLookup) {
      country = await one(
        `SELECT id, iso_code AS code FROM countries WHERE upper(iso_code) = upper($1) OR upper(name) = upper($1)`,
        [countryCodeLookup],
      );
    }
    return { country, school };
  }

  async function listRolesWithUsage({ includeArchived = true } = {}) {
    const hasUserRoles = await one(`SELECT to_regclass('public.user_roles') AS ref`);
    const usageJoin = hasUserRoles?.ref
      ? `LEFT JOIN (
           SELECT upper(role_key) AS role_key, COUNT(*)::int AS active_count
           FROM user_roles
           WHERE status = 'active'
           GROUP BY upper(role_key)
         ) ur ON ur.role_key = upper(er.role_code)`
      : `LEFT JOIN (SELECT NULL::text AS role_key, 0 AS active_count WHERE FALSE) ur ON FALSE`;
    const rows = await all(
      `SELECT er.*,
              COALESCE(ur.active_count, 0)::int AS active_user_count
       FROM establishment_roles er
       ${usageJoin}
       WHERE ($1::boolean OR er.status = 'active')
       ORDER BY er.display_order, er.role_name`,
      [includeArchived],
    );
    return rows.map((row) => ({
      id: row.id,
      roleCode: row.role_code,
      roleName: row.role_name,
      scope: row.scope,
      displayOrder: Number(row.display_order ?? 0),
      status: row.status === "archived" ? "archived" : "active",
      schoolAssignable: Boolean(row.school_assignable),
      systemProtected: Boolean(row.system_protected),
      activeUserCount: Number(row.active_user_count ?? 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async function markSystemProtected(roleCodes = []) {
    if (!roleCodes.length) return;
    await query(
      `UPDATE establishment_roles
       SET system_protected = TRUE, school_assignable = FALSE, updated_at = NOW()
       WHERE upper(role_code) = ANY($1::text[])`,
      [roleCodes.map((code) => String(code).toUpperCase())],
    );
  }

  return {
    seedFunctionalModules,
    listModules,
    listGrantsForRoles,
    listGrantsForScope,
    maxUpdatedAtForScope,
    countActiveGrants,
    upsertGrant,
    resolveCountryAndSchool,
    listRolesWithUsage,
    markSystemProtected,
  };
}

module.exports = {
  createFunctionalRbacPgStore,
  mapGrantRow,
};
