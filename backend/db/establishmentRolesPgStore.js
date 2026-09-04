"use strict";

const {
  ESTABLISHMENT_ROLES_ERROR,
  asTrimmed,
  normalizeRoleCode,
  createEstablishmentRolesError,
  mapRoleRow,
  sanitizePermissionList,
} = require("../lib/establishmentRolesManagement");

function createEstablishmentRolesPgStore(repo) {
  const one = (...args) => repo.one(...args);
  const all = (...args) => repo.all(...args);
  const query = (...args) => repo.query(...args);

  async function loadRolePermissions(roleId) {
    const rows = await all(
      `SELECT permission FROM establishment_role_permissions WHERE role_id = $1::uuid ORDER BY permission`,
      [roleId],
    );
    return rows.map((row) => row.permission);
  }

  async function loadDelegationPermissions(roleId) {
    const rows = await all(
      `SELECT permission FROM establishment_role_delegation_permissions WHERE role_id = $1::uuid ORDER BY permission`,
      [roleId],
    );
    return rows.map((row) => row.permission);
  }

  async function hydrateRole(row) {
    if (!row) return null;
    const permissions = await loadRolePermissions(row.id);
    const delegationPermissions = await loadDelegationPermissions(row.id);
    return mapRoleRow({ ...row, permissions, delegation_permissions: delegationPermissions });
  }

  async function listRoles({ includeArchived = false, schoolAssignableOnly = false } = {}) {
    const rows = await all(
      `SELECT *
       FROM establishment_roles
       WHERE ($1::boolean OR status = 'active')
         AND ($2::boolean OR school_assignable = TRUE)
       ORDER BY display_order, role_name`,
      [includeArchived, !schoolAssignableOnly],
    );
    return Promise.all(rows.map((row) => hydrateRole(row)));
  }

  async function getRoleById(roleId) {
    const row = await one(`SELECT * FROM establishment_roles WHERE id = $1::uuid`, [roleId]);
    return hydrateRole(row);
  }

  async function getRoleByNameOrCode(value) {
    const normalized = asTrimmed(value);
    if (!normalized) return null;
    const row = await one(
      `SELECT * FROM establishment_roles
       WHERE lower(role_name) = lower($1)
          OR lower(role_code) = lower($1)
          OR upper(role_code) = upper($1)
       LIMIT 1`,
      [normalized],
    );
    return hydrateRole(row);
  }

  async function replaceRolePermissions(roleId, permissions) {
    await query(`DELETE FROM establishment_role_permissions WHERE role_id = $1::uuid`, [roleId]);
    for (const permission of permissions) {
      await query(
        `INSERT INTO establishment_role_permissions (role_id, permission) VALUES ($1::uuid, $2)`,
        [roleId, permission],
      );
    }
  }

  async function replaceDelegationPermissions(roleId, permissions) {
    await query(`DELETE FROM establishment_role_delegation_permissions WHERE role_id = $1::uuid`, [roleId]);
    for (const permission of permissions) {
      await query(
        `INSERT INTO establishment_role_delegation_permissions (role_id, permission) VALUES ($1::uuid, $2)`,
        [roleId, permission],
      );
    }
  }

  async function addMissingPermissions(roleId, permissions = []) {
    const added = [];
    for (const permission of sanitizePermissionList(permissions)) {
      const row = await one(
        `INSERT INTO establishment_role_permissions (role_id, permission)
         VALUES ($1::uuid, $2)
         ON CONFLICT (role_id, permission) DO NOTHING
         RETURNING permission`,
        [roleId, permission],
      );
      if (row?.permission) added.push(row.permission);
    }
    return added;
  }

  async function addMissingDelegationPermissions(roleId, permissions = []) {
    const added = [];
    for (const permission of sanitizePermissionList(permissions)) {
      const row = await one(
        `INSERT INTO establishment_role_delegation_permissions (role_id, permission)
         VALUES ($1::uuid, $2)
         ON CONFLICT (role_id, permission) DO NOTHING
         RETURNING permission`,
        [roleId, permission],
      );
      if (row?.permission) added.push(row.permission);
    }
    return added;
  }

  async function insertRole(input) {
    const row = await one(
      `INSERT INTO establishment_roles (role_code, role_name, scope, display_order, status, school_assignable)
       VALUES ($1, $2, $3, $4, 'active', $5)
       RETURNING *`,
      [
        input.roleCode,
        input.roleName,
        input.scope ?? "school",
        input.displayOrder ?? 0,
        input.schoolAssignable !== false,
      ],
    );
    await replaceRolePermissions(row.id, input.permissions ?? []);
    await replaceDelegationPermissions(row.id, input.delegationPermissions ?? []);
    return getRoleById(row.id);
  }

  async function updateRole(roleId, patch) {
    const row = await one(
      `UPDATE establishment_roles
       SET role_name = COALESCE($2, role_name),
           display_order = COALESCE($3, display_order),
           school_assignable = COALESCE($4, school_assignable),
           updated_at = NOW()
       WHERE id = $1::uuid AND status = 'active'
       RETURNING *`,
      [
        roleId,
        patch.roleName ?? null,
        patch.displayOrder ?? null,
        patch.schoolAssignable ?? null,
      ],
    );
    if (!row) return null;
    if (patch.permissions !== undefined) {
      await replaceRolePermissions(roleId, patch.permissions);
    }
    if (patch.delegationPermissions !== undefined) {
      await replaceDelegationPermissions(roleId, patch.delegationPermissions);
    }
    return getRoleById(roleId);
  }

  async function archiveRole(roleId) {
    const row = await one(
      `UPDATE establishment_roles
       SET status = 'archived', updated_at = NOW()
       WHERE id = $1::uuid AND status = 'active'
       RETURNING *`,
      [roleId],
    );
    return hydrateRole(row);
  }

  async function getPermissionsMap() {
    const rows = await all(
      `SELECT er.role_name, er.role_code, erp.permission
       FROM establishment_roles er
       LEFT JOIN establishment_role_permissions erp ON erp.role_id = er.id
       WHERE er.status = 'active'
       ORDER BY er.role_name, erp.permission`,
    );
    const map = {};
    for (const row of rows) {
      if (!map[row.role_name]) {
        map[row.role_name] = [];
        if (row.role_code) {
          map[row.role_code] = map[row.role_name];
        }
      }
      if (row.permission) {
        map[row.role_name].push(row.permission);
      }
    }
    return map;
  }

  async function inventoryLegacyUserRolesPayloads() {
    const rows = await all(
      `SELECT s.school_code, sac.config_payload
       FROM school_academic_configs sac
       JOIN schools s ON s.id = sac.school_id`,
    );
    const ambiguous = [];
    for (const row of rows) {
      let payload = row.config_payload;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          payload = {};
        }
      }
      const userRoles = Array.isArray(payload?.userRoles)
        ? payload.userRoles.filter((value) => asTrimmed(value))
        : [];
      if (userRoles.length) {
        ambiguous.push({
          schoolCode: row.school_code,
          userRolesCount: userRoles.length,
          userRolesSample: userRoles.slice(0, 3),
        });
      }
    }
    return ambiguous;
  }

  async function seedDefaultRolesIfEmpty(seedRoles = []) {
    const existing = await one(`SELECT COUNT(*)::int AS count FROM establishment_roles`);
    if (Number(existing?.count ?? 0) > 0) return false;
    for (const [index, role] of seedRoles.entries()) {
      const roleCode = normalizeRoleCode(role.roleCode || role.roleName);
      await insertRole({
        roleCode,
        roleName: role.roleName,
        scope: "school",
        displayOrder: index,
        schoolAssignable: role.schoolAssignable !== false,
        permissions: sanitizePermissionList(role.permissions ?? []),
        delegationPermissions: sanitizePermissionList(role.delegationPermissions ?? role.permissions ?? []),
      });
    }
    return true;
  }

  return {
    listRoles,
    getRoleById,
    getRoleByNameOrCode,
    insertRole,
    updateRole,
    archiveRole,
    getPermissionsMap,
    inventoryLegacyUserRolesPayloads,
    seedDefaultRolesIfEmpty,
    addMissingPermissions,
    addMissingDelegationPermissions,
  };
}

module.exports = {
  createEstablishmentRolesPgStore,
};
