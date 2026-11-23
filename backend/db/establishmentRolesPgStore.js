"use strict";

const {
  ESTABLISHMENT_ROLES_ERROR,
  asTrimmed,
  normalizeRoleCode,
  createEstablishmentRolesError,
  mapRoleRow,
  sanitizePermissionList,
} = require("../lib/establishmentRolesManagement");

const ROLE_ASSIGNMENT_PREREQUISITES_SQL = `
  SELECT to_regclass('public.user_roles') IS NOT NULL AS user_roles,
         to_regprocedure('public.somafrik_normalize_role_code(text)') IS NOT NULL AS normalize_fn
`;

/**
 * RBAC-LOGIN-01 — $1 = role_code, $2 = role_name. Filtre et agrège dans PostgreSQL ;
 * prédicats alignés sur l'index partiel idx_user_roles_active_normalized_key.
 */
const COUNT_ACTIVE_ROLE_ASSIGNMENTS_SQL = `
  SELECT COUNT(*)::int AS active_assignments,
         COUNT(DISTINCT ur.school_id)::int AS schools,
         COUNT(*) FILTER (WHERE ur.school_id IS NULL)::int AS platform_assignments
  FROM user_roles ur
  WHERE ur.status = 'active'
    AND ur.revoked_at IS NULL
    AND somafrik_normalize_role_code(ur.role_key)
        = ANY (ARRAY[somafrik_normalize_role_code($1), somafrik_normalize_role_code($2)])
`;

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

  async function updateRoleDisplayLabel(roleId, displayLabel) {
    const row = await one(
      `UPDATE establishment_roles
       SET display_label = $2, updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING *`,
      [roleId, displayLabel],
    );
    return hydrateRole(row);
  }

  async function listRoleDisplayContracts() {
    const { applyRoleDisplayContract } = require("../lib/roleDisplayLabels");
    const rows = await all(`SELECT role_code, role_name, display_label FROM establishment_roles`);
    return rows.map((row) => applyRoleDisplayContract(row));
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

  /**
   * RBAC-LOGIN-01 — garde d'archivage : verrouille la ligne du catalogue (FOR UPDATE)
   * jusqu'à la fin de la transaction. Un octroi concurrent du même rôle pose un
   * FOR SHARE sur cette ligne : les deux opérations sont sérialisées.
   */
  async function lockRoleForArchive(roleId) {
    const row = await one(`SELECT * FROM establishment_roles WHERE id = $1::uuid FOR UPDATE`, [roleId]);
    return hydrateRole(row);
  }

  /**
   * RBAC-LOGIN-01 — affectations actives d'un rôle, comptées dans PostgreSQL.
   * Clés équivalentes (casse, accents, séparateurs) via somafrik_normalize_role_code,
   * appliquée au role_code et au role_name du rôle ; index partiel
   * idx_user_roles_active_normalized_key. Lu après le verrou FOR UPDATE : chaque
   * instruction voit les octrois validés entre-temps (READ COMMITTED).
   * Fail-closed : table, fonction ou lecture indisponible → erreur 503, jamais « 0 ».
   */
  async function countActiveAssignmentsForRole(role) {
    const unavailable = () =>
      createEstablishmentRolesError(
        503,
        "Vérification des affectations du rôle indisponible : archivage refusé.",
        ESTABLISHMENT_ROLES_ERROR.ROLE_ASSIGNMENTS_UNAVAILABLE,
      );
    const roleCode = asTrimmed(role?.roleCode);
    const roleName = asTrimmed(role?.roleName);
    if (!roleCode && !roleName) throw unavailable();
    let prerequisites;
    try {
      prerequisites = await one(ROLE_ASSIGNMENT_PREREQUISITES_SQL);
    } catch {
      throw unavailable();
    }
    if (!prerequisites?.user_roles || !prerequisites?.normalize_fn) throw unavailable();
    let row;
    try {
      row = await one(COUNT_ACTIVE_ROLE_ASSIGNMENTS_SQL, [roleCode, roleName]);
    } catch {
      throw unavailable();
    }
    const activeAssignments = Number(row?.active_assignments);
    const schools = Number(row?.schools);
    const platformAssignments = Number(row?.platform_assignments);
    if (![activeAssignments, schools, platformAssignments].every(Number.isInteger)) throw unavailable();
    return { activeAssignments, schools, platformAssignments };
  }

  /**
   * RBAC-LOGIN-01 — état minimal du catalogue (actifs et archivés) en une requête,
   * sans permissions : lu sur le chemin des requêtes protégées.
   */
  async function listRoleCatalogStates() {
    const rows = await all(
      `SELECT role_code, role_name, scope, status, school_assignable
       FROM establishment_roles`,
    );
    return rows.map((row) => ({
      roleCode: row.role_code,
      roleName: row.role_name,
      scope: row.scope,
      status: row.status === "archived" ? "archived" : "active",
      schoolAssignable: Boolean(row.school_assignable),
    }));
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
    updateRoleDisplayLabel,
    listRoleDisplayContracts,
    archiveRole,
    listRoleCatalogStates,
    lockRoleForArchive,
    countActiveAssignmentsForRole,
    getPermissionsMap,
    inventoryLegacyUserRolesPayloads,
    seedDefaultRolesIfEmpty,
    addMissingPermissions,
    addMissingDelegationPermissions,
  };
}

module.exports = {
  createEstablishmentRolesPgStore,
  COUNT_ACTIVE_ROLE_ASSIGNMENTS_SQL,
  ROLE_ASSIGNMENT_PREREQUISITES_SQL,
};
