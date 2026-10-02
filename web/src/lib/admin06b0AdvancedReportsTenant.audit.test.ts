import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SessionUser } from "../types";
import { canReadView, type PermissionContext } from "./permissions";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import { isSuperAdminAllowedView } from "./superAdminAccess";

const ROOT = dirname(fileURLToPath(import.meta.url));

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
    identifier: "super-1",
    role: SUPER_ADMIN_ROLE,
    permissions: ["ALL_PRIVILEGES"],
    schoolCode: "*",
  } as SessionUser;
}

function countryAdmin(): SessionUser {
  return {
    id: "pays-1",
    identifier: "pays-1",
    role: COUNTRY_ADMIN_ROLE,
    permissions: ["COUNTRY_PRIVILEGES"],
    schoolCode: "*",
  } as SessionUser;
}

function schoolAdmin(): SessionUser {
  return {
    id: "admin-nuru",
    identifier: "admin-nuru",
    role: SCHOOL_ADMIN_ROLE,
    permissions: ["Rapports:READ"],
    schoolCode: "CD-2026-0001",
  } as SessionUser;
}

describe("ADMIN-06B0 Conformité — tenant safety + façade Country", () => {
  it("R06B0-16 COUNTRY_ADMIN canReadView(reports) = false", () => {
    expect(canReadView(ctx(countryAdmin()), "reports")).toBe(false);
    expect(canReadView(ctx(superadmin()), "reports")).toBe(false);
    expect(isSuperAdminAllowedView("reports")).toBe(false);
    const permissions = readFileSync(join(ROOT, "permissions.ts"), "utf8");
    expect(permissions).not.toContain('feature !== "Rapports"');
  });

  it("R06B0-17 SCHOOL_ADMIN Rapports:READ = true", () => {
    expect(canReadView(ctx(schoolAdmin()), "reports")).toBe(true);
  });

  it("ReportsPage reste MVP_COVERAGE", () => {
    const page = readFileSync(join(ROOT, "../pages/ReportsPage.tsx"), "utf8");
    expect(page).toContain("MVP_COVERAGE");
    expect(page).not.toMatch(/erasure-requests|data-export|\/api\/audit/);
  });
});
