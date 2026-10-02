import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SessionUser } from "../types";
import { canReadView, type PermissionContext } from "./permissions";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import { isSuperAdminAllowedFeature, isSuperAdminAllowedView } from "./superAdminAccess";
import { INTERNAL_ROLE_DEFAULT_PERMISSIONS } from "./internalRoleDefaults";
import { PLATFORM_COMPLIANCE_PATH } from "./platformComplianceApi";

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

function schoolAdmin(): SessionUser {
  return {
    id: "admin-nuru",
    firstName: "Admin",
    lastName: "Nuru",
    identifier: "admin-nuru",
    role: SCHOOL_ADMIN_ROLE,
    permissions: ["Rapports:READ"],
    schoolCode: "CD-2026-0001",
  } as SessionUser;
}

describe("ADMIN-06B1 Conformité plateforme A1", () => {
  it("C06B1-01 SUPER_ADMIN canReadView(reports) = true", () => {
    expect(isSuperAdminAllowedView("reports")).toBe(true);
    expect(isSuperAdminAllowedFeature("Rapports")).toBe(false);
    expect(canReadView(ctx(superadmin()), "reports")).toBe(true);
    const access = readFileSync(join(ROOT, "superAdminAccess.ts"), "utf8");
    expect(access).toContain('"reports"');
    expect(access).not.toContain('"Rapports"');
  });

  it("C06B1-02 COUNTRY_ADMIN canReadView(reports) = false", () => {
    expect(canReadView(ctx(countryAdmin()), "reports")).toBe(false);
  });

  it("C06B1-03 SCHOOL_ADMIN Rapports:READ reste true", () => {
    expect(canReadView(ctx(schoolAdmin()), "reports")).toBe(true);
    expect(INTERNAL_ROLE_DEFAULT_PERMISSIONS["Admin School"]).toContain("Rapports:READ");
  });

  it("C06B1-19 ReportsPage Superadmin fetch A1 uniquement", () => {
    const page = readFileSync(join(ROOT, "../pages/ReportsPage.tsx"), "utf8");
    const api = readFileSync(join(ROOT, "platformComplianceApi.ts"), "utf8");
    expect(api).toContain('"/backoffice/platform-compliance"');
    expect(api).toContain("api.get<PlatformCompliancePayload>(PLATFORM_COMPLIANCE_PATH)");
    expect(api).not.toMatch(/schoolCode|schoolId|countryCode|userId|requestId/);
    expect(api).not.toMatch(/api\.(post|put|patch|delete)/);
    expect(PLATFORM_COMPLIANCE_PATH).toBe("/backoffice/platform-compliance");
    expect(page).toContain("isSuperAdminRole");
    expect(page).toContain("getPlatformCompliance");
    expect(page).toContain("Conformité plateforme");
    expect(page).not.toMatch(/erasure-requests|\/api\/audit|data-export|reports\/advanced/);
  });

  it("C06B1-20 ReportsPage School Admin ne fetch PAS A1", () => {
    const page = readFileSync(join(ROOT, "../pages/ReportsPage.tsx"), "utf8");
    expect(page).toContain("MVP_COVERAGE");
    expect(page).toContain("SchoolMvpCoverageFacade");
    expect(page).toMatch(/if \(isSuperAdminRole\(session\?\.user\?\.role\)\)/);
    expect(page).toContain("getPlatformCompliance()");
  });

  it("C06B1-21 Country Admin n’ouvre pas ReportsPage", () => {
    expect(canReadView(ctx(countryAdmin()), "reports")).toBe(false);
    const layout = readFileSync(join(ROOT, "../pages/administration/AdministrationLayout.tsx"), "utf8");
    const app = readFileSync(join(ROOT, "../App.tsx"), "utf8");
    expect(layout).toContain('view: "reports"');
    expect(layout).toContain("canReadView(ctx, tab.view)");
    expect(app).toContain('view="reports"');
    expect(app).toContain("<ReportsPage />");
    expect(app).toContain("PermissionRoute");
  });

  it("C06B1-22 erreur A1 UI ≠ faux état conforme", () => {
    const page = readFileSync(join(ROOT, "../pages/ReportsPage.tsx"), "utf8");
    expect(page).toContain('status: "loading"');
    expect(page).toContain('status: "error"');
    expect(page).toContain('status: "success"');
    expect(page).toContain("Impossible de charger la conformité plateforme");
    expect(page).toContain("ErrorState");
    expect(page).toMatch(/state\.status === "success"[\s\S]*configurée/);
    expect(page).not.toMatch(/status === "error"[\s\S]*configurée/);
  });
});
