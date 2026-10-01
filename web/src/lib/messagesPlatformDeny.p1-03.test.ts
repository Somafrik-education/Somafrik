import { describe, expect, it } from "vitest";
import { canReadView, hasBackOfficePermission, type PermissionContext } from "./permissions";
import { isSuperAdminAllowedView } from "./superAdminAccess";
import { canLoadDomain } from "./domainPermissions";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import type { SessionUser } from "../types";

function ctx(user: Partial<SessionUser>): PermissionContext {
  return {
    user: user as SessionUser,
    rolePermissions: {},
    permissionsReady: true,
  };
}

describe("P1-03 Web Messages — Superadmin n'est pas un lecteur scolaire", () => {
  it("Superadmin : vue Messages fermée, même avec ALL_PRIVILEGES", () => {
    const superadmin = ctx({
      role: SUPER_ADMIN_ROLE,
      permissions: ["ALL_PRIVILEGES"],
      schoolCode: "*",
    });
    expect(isSuperAdminAllowedView("messages")).toBe(false);
    expect(canReadView(superadmin, "messages")).toBe(false);
    expect(hasBackOfficePermission(superadmin, "Messages", "READ")).toBe(false);
    expect(canLoadDomain(superadmin, "messages")).toBe(false);
  });

  it("Admin Pays : Messages scolaires refusés", () => {
    const country = ctx({
      role: COUNTRY_ADMIN_ROLE,
      permissions: ["COUNTRY_PRIVILEGES"],
      schoolCode: "*",
    });
    expect(canReadView(country, "messages")).toBe(false);
    expect(hasBackOfficePermission(country, "Messages", "READ")).toBe(false);
    expect(canLoadDomain(country, "messages")).toBe(false);
  });

  it("Admin School conserve Messages de son établissement", () => {
    const admin = ctx({
      role: SCHOOL_ADMIN_ROLE,
      permissions: ["Messages:READ", "Messages:CREATE"],
      schoolCode: "CD-2026-0001",
    });
    expect(canReadView(admin, "messages")).toBe(true);
    expect(hasBackOfficePermission(admin, "Messages", "READ")).toBe(true);
    expect(canLoadDomain(admin, "messages")).toBe(true);
  });

  it("ALL_PRIVILEGES seul n'ouvre pas la vue Messages Superadmin", () => {
    const onlyPrivileges = ctx({
      role: SUPER_ADMIN_ROLE,
      permissions: ["ALL_PRIVILEGES"],
      schoolCode: "*",
    });
    expect(canReadView(onlyPrivileges, "messages")).toBe(false);
  });
});
