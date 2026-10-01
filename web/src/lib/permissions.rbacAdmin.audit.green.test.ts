import { describe, expect, it } from "vitest";
import { canAccessView, canManageRolePermissions, canReadView, type PermissionContext } from "./permissions";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import type { SessionUser } from "../types";

function ctx(role: string, permissions: string[] = []): PermissionContext {
  return {
    user: { id: "u1", role, permissions, schoolCode: role === SUPER_ADMIN_ROLE ? "*" : "CD-2026-0001" } as SessionUser,
    rolePermissions: {},
    permissionsReady: true,
  };
}

describe("canManageRolePermissions / vue permissions — GREEN audit", () => {
  it("seul Superadmin gère la matrice ; SCHOOL_ADMIN et Admin Pays sont refusés", () => {
    expect(canManageRolePermissions(ctx(SUPER_ADMIN_ROLE, ["ALL_PRIVILEGES"]))).toBe(true);
    expect(canManageRolePermissions(ctx(SCHOOL_ADMIN_ROLE, ["Gérer utilisateurs"]))).toBe(false);
    expect(canManageRolePermissions(ctx(COUNTRY_ADMIN_ROLE, ["COUNTRY_PRIVILEGES"]))).toBe(false);
    expect(canManageRolePermissions(ctx("Directeur", ["Élèves:UPDATE"]))).toBe(false);
  });

  it("vue Administration /permissions fermée pour SCHOOL_ADMIN, ouverte Superadmin", () => {
    expect(canReadView(ctx(SUPER_ADMIN_ROLE, ["ALL_PRIVILEGES"]), "permissions")).toBe(true);
    expect(canAccessView(ctx(SUPER_ADMIN_ROLE, ["ALL_PRIVILEGES"]), "permissions", "UPDATE")).toBe(true);
    expect(canReadView(ctx(SCHOOL_ADMIN_ROLE, ["Gérer utilisateurs", "ALL_PRIVILEGES"]), "permissions")).toBe(false);
    expect(canReadView(ctx(COUNTRY_ADMIN_ROLE, ["COUNTRY_PRIVILEGES"]), "permissions")).toBe(false);
  });
});
