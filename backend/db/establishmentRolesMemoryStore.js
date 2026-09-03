"use strict";

const { randomUUID } = require("node:crypto");
const {
  ESTABLISHMENT_ROLES_ERROR,
  asTrimmed,
  normalizeRoleCode,
  createEstablishmentRolesError,
  mapRoleRow,
  sanitizePermissionList,
  assertSuperAdmin,
  isPlatformRoleName,
} = require("../lib/establishmentRolesManagement");

function createEstablishmentRolesMemoryStore(seed = {}) {
  const roles = [];
  const permissions = new Map();
  const delegationPermissions = new Map();

  for (const role of seed.roles ?? []) {
    const row = {
      id: role.id ?? randomUUID(),
      role_code: role.roleCode ?? normalizeRoleCode(role.roleName),
      role_name: role.roleName,
      scope: role.scope ?? "school",
      display_order: role.displayOrder ?? 0,
      status: role.status ?? "active",
      school_assignable: role.schoolAssignable !== false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    roles.push(row);
    permissions.set(row.id, [...(role.permissions ?? [])]);
    delegationPermissions.set(row.id, [...(role.delegationPermissions ?? role.permissions ?? [])]);
  }

  function hydrateRole(row) {
    if (!row) return null;
    return mapRoleRow({
      ...row,
      permissions: permissions.get(row.id) ?? [],
      delegation_permissions: delegationPermissions.get(row.id) ?? [],
    });
  }

  return {
    async listRoles({ includeArchived = false, schoolAssignableOnly = false } = {}) {
      return roles
        .filter((row) => (includeArchived || row.status === "active"))
        .filter((row) => !schoolAssignableOnly || row.school_assignable)
        .sort((a, b) => a.display_order - b.display_order || a.role_name.localeCompare(b.role_name))
        .map((row) => hydrateRole(row));
    },
    async getRoleById(roleId) {
      return hydrateRole(roles.find((row) => row.id === roleId) ?? null);
    },
    async getRoleByNameOrCode(value) {
      const normalized = asTrimmed(value).toLowerCase();
      const row = roles.find(
        (item) =>
          item.role_name.toLowerCase() === normalized ||
          item.role_code.toLowerCase() === normalized ||
          item.role_code.toUpperCase() === asTrimmed(value).toUpperCase(),
      );
      return hydrateRole(row ?? null);
    },
    async insertRole(input) {
      if (roles.some((row) => row.role_code === input.roleCode || row.role_name === input.roleName)) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }
      const row = {
        id: randomUUID(),
        role_code: input.roleCode,
        role_name: input.roleName,
        scope: input.scope ?? "school",
        display_order: input.displayOrder ?? 0,
        status: "active",
        school_assignable: input.schoolAssignable !== false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      roles.push(row);
      permissions.set(row.id, [...(input.permissions ?? [])]);
      delegationPermissions.set(row.id, [...(input.delegationPermissions ?? [])]);
      return hydrateRole(row);
    },
    async updateRole(roleId, patch) {
      const index = roles.findIndex((row) => row.id === roleId && row.status === "active");
      if (index < 0) return null;
      roles[index] = {
        ...roles[index],
        role_name: patch.roleName ?? roles[index].role_name,
        display_order: patch.displayOrder ?? roles[index].display_order,
        school_assignable: patch.schoolAssignable ?? roles[index].school_assignable,
        updated_at: new Date().toISOString(),
      };
      if (patch.permissions !== undefined) permissions.set(roleId, [...patch.permissions]);
      if (patch.delegationPermissions !== undefined) delegationPermissions.set(roleId, [...patch.delegationPermissions]);
      return hydrateRole(roles[index]);
    },
    async archiveRole(roleId) {
      const index = roles.findIndex((row) => row.id === roleId && row.status === "active");
      if (index < 0) return null;
      roles[index] = { ...roles[index], status: "archived", updated_at: new Date().toISOString() };
      return hydrateRole(roles[index]);
    },
    async getPermissionsMap() {
      const map = {};
      for (const row of roles.filter((item) => item.status === "active")) {
        map[row.role_name] = [...(permissions.get(row.id) ?? [])];
        if (row.role_code) {
          map[row.role_code] = map[row.role_name];
        }
      }
      return map;
    },
    async addMissingPermissions(roleId, nextPermissions = []) {
      const current = permissions.get(roleId) ?? [];
      const have = new Set(current);
      const added = [];
      for (const permission of sanitizePermissionList(nextPermissions)) {
        if (have.has(permission)) continue;
        have.add(permission);
        added.push(permission);
      }
      if (added.length) permissions.set(roleId, [...have].sort((left, right) => left.localeCompare(right, "fr")));
      return added;
    },
    async addMissingDelegationPermissions(roleId, nextPermissions = []) {
      const current = delegationPermissions.get(roleId) ?? [];
      const have = new Set(current);
      const added = [];
      for (const permission of sanitizePermissionList(nextPermissions)) {
        if (have.has(permission)) continue;
        have.add(permission);
        added.push(permission);
      }
      if (added.length) {
        delegationPermissions.set(roleId, [...have].sort((left, right) => left.localeCompare(right, "fr")));
      }
      return added;
    },
    async inventoryLegacyUserRolesPayloads() {
      return [];
    },
    async seedDefaultRolesIfEmpty(seedRoles = []) {
      if (roles.length > 0) return false;
      for (const [index, role] of seedRoles.entries()) {
        await this.insertRole({
          roleCode: normalizeRoleCode(role.roleCode || role.roleName),
          roleName: role.roleName,
          displayOrder: index,
          permissions: sanitizePermissionList(role.permissions ?? []),
          delegationPermissions: sanitizePermissionList(role.delegationPermissions ?? role.permissions ?? []),
        });
      }
      return true;
    },
  };
}

module.exports = {
  createEstablishmentRolesMemoryStore,
};
