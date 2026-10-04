import { describe, expect, it } from "vitest";
import type { SessionUser } from "../types";
import { canReadView, type PermissionContext } from "./permissions";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import { isSuperAdminAllowedFeature, isSuperAdminAllowedView } from "./superAdminAccess";

function ctx(user: Partial<SessionUser>): PermissionContext {
  return {
    user: user as SessionUser,
    rolePermissions: {},
    permissionsReady: true,
  };
}

function superadmin(): SessionUser {
  return {
    id: "super-1",
    firstName: "Super",
    lastName: "Admin",
    identifier: "super-1",
    role: SUPER_ADMIN_ROLE,
    permissions: ["ALL_PRIVILEGES"],
    schoolCode: "*",
  } as SessionUser;
}

function countryAdmin(): SessionUser {
  return {
    id: "pays-1",
    firstName: "Admin",
    lastName: "Pays",
    identifier: "pays-1",
    role: COUNTRY_ADMIN_ROLE,
    permissions: ["COUNTRY_PRIVILEGES"],
    schoolCode: "*",
  } as SessionUser;
}

function schoolAdmin(permissions: string[]): SessionUser {
  return {
    id: "admin-nuru",
    firstName: "Admin",
    lastName: "Nuru",
    identifier: "admin-nuru",
    role: SCHOOL_ADMIN_ROLE,
    permissions,
    schoolCode: "CD-2026-0001",
  } as SessionUser;
}

describe("ADMIN-07 — autorité Web replay", () => {
  it("A07 Superadmin : Relations / Documents / export / audit masqués ; A1 reports ouvert", () => {
    expect(isSuperAdminAllowedView("relations")).toBe(false);
    expect(isSuperAdminAllowedView("documents")).toBe(false);
    expect(isSuperAdminAllowedFeature("Relations")).toBe(false);
    expect(isSuperAdminAllowedFeature("Documents")).toBe(false);
    expect(canReadView(ctx(superadmin()), "relations")).toBe(false);
    expect(canReadView(ctx(superadmin()), "documents")).toBe(false);
    expect(canReadView(ctx(superadmin()), "dataExport")).toBe(false);
    expect(canReadView(ctx(superadmin()), "users")).toBe(true);
    expect(canReadView(ctx(superadmin()), "permissions")).toBe(true);
    expect(canReadView(ctx(superadmin()), "reports")).toBe(true);
  });

  it("A07 Country : Relations / Documents / reports / export refusés", () => {
    expect(canReadView(ctx(countryAdmin()), "relations")).toBe(false);
    expect(canReadView(ctx(countryAdmin()), "documents")).toBe(false);
    expect(canReadView(ctx(countryAdmin()), "reports")).toBe(false);
    expect(canReadView(ctx(countryAdmin()), "dataExport")).toBe(false);
  });

  it("A07 SCHOOL_ADMIN : tenant views selon tokens exacts", () => {
    const school = schoolAdmin([
      "Relations:READ",
      "Documents:READ",
      "Utilisateurs:READ",
      "Paramètres Établissement:READ",
      "Rapports:READ",
    ]);
    expect(canReadView(ctx(school), "relations")).toBe(true);
    expect(canReadView(ctx(school), "documents")).toBe(true);
    expect(canReadView(ctx(school), "users")).toBe(true);
    expect(canReadView(ctx(school), "dataExport")).toBe(true);
    expect(canReadView(ctx(school), "reports")).toBe(true);
    expect(canReadView(ctx(schoolAdmin(["Rapports:READ"])), "dataExport")).toBe(false);
    const teacher = {
      id: "teacher-1",
      firstName: "Enseignant",
      lastName: "A",
      identifier: "teacher-1",
      role: "Enseignant",
      permissions: ["Paramètres Établissement:READ"],
      schoolCode: "CD-2026-0001",
    } as SessionUser;
    expect(canReadView(ctx(teacher), "relations")).toBe(false);
    expect(canReadView(ctx(teacher), "dataExport")).toBe(false);
  });
});
