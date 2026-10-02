import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SessionUser } from "../types";
import { canReadView, type PermissionContext } from "./permissions";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import { isSuperAdminAllowedFeature, isSuperAdminAllowedView } from "./superAdminAccess";
import { INTERNAL_ROLE_DEFAULT_PERMISSIONS } from "./internalRoleDefaults";
import { VIEW_PERMISSION_FEATURES, MVP_COVERAGE } from "./constants";

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

function teacher(): SessionUser {
  return {
    id: "teacher-1",
    firstName: "Enseignant",
    lastName: "Test",
    identifier: "teacher-1",
    role: "Enseignant",
    permissions: ["Élèves:READ", "Notes:READ"],
    schoolCode: "CD-2026-0001",
  } as SessionUser;
}

describe("ADMIN-06A Conformité — UI et canReadView(reports)", () => {
  it("C06A-01 ReportsPage school = MVP_COVERAGE ; Superadmin = A1 (ADMIN-06B1)", () => {
    const page = readFileSync(join(ROOT, "../pages/ReportsPage.tsx"), "utf8");
    expect(page).toContain('import { MVP_COVERAGE } from "../lib/constants"');
    expect(page).toContain("MVP_COVERAGE");
    expect(page).toContain("getPlatformCompliance");
    expect(page).not.toMatch(/erasure-requests|\/api\/audit|data-export|reports\/advanced/);
    expect(MVP_COVERAGE.length).toBeGreaterThan(0);
    expect(MVP_COVERAGE[0]).toMatchObject({ module: "Authentification par établissement" });
  });

  it("C06A-02 Superadmin canReadView(reports) = true (vue plateforme ADMIN-06B1)", () => {
    expect(isSuperAdminAllowedView("reports")).toBe(true);
    expect(isSuperAdminAllowedFeature("Rapports")).toBe(false);
    expect(canReadView(ctx(superadmin()), "reports")).toBe(true);
    const access = readFileSync(join(ROOT, "superAdminAccess.ts"), "utf8");
    expect(access).toContain('"reports"');
    expect(access).not.toContain('"Rapports"');
  });

  it("C06A-03 Country Admin canReadView(reports) = false (ADMIN-06B0)", () => {
    expect(VIEW_PERMISSION_FEATURES.reports).toBe("Rapports");
    expect(canReadView(ctx(countryAdmin()), "reports")).toBe(false);
  });

  it("C06A-04 School Admin canReadView(reports) = true (façade)", () => {
    expect(canReadView(ctx(schoolAdmin()), "reports")).toBe(true);
    expect(INTERNAL_ROLE_DEFAULT_PERMISSIONS["Admin School"]).toContain("Rapports:READ");
    expect(canReadView(ctx(teacher()), "reports")).toBe(false);
    expect(INTERNAL_ROLE_DEFAULT_PERMISSIONS.Enseignant).not.toContain("Rapports:READ");
  });

  it("C06A layout filtre Conformité par canReadView(reports)", () => {
    const layout = readFileSync(join(ROOT, "../pages/administration/AdministrationLayout.tsx"), "utf8");
    expect(layout).toContain('to: "/administration/conformite"');
    expect(layout).toContain('view: "reports"');
    expect(layout).toContain("canReadView(ctx, tab.view)");
    const app = readFileSync(join(ROOT, "../App.tsx"), "utf8");
    expect(app).toContain('path="conformite"');
    expect(app).toContain('view="reports"');
    expect(app).toContain("<ReportsPage />");
  });

  it("C06A-14 routes publiques confidentialité / suppression", () => {
    const app = readFileSync(join(ROOT, "../App.tsx"), "utf8");
    const legal = readFileSync(join(ROOT, "../pages/LegalPages.tsx"), "utf8");
    expect(app).toContain('path="/confidentialite"');
    expect(app).toContain('path="/suppression-compte"');
    expect(legal).toContain("/api/privacy/erasure-requests");
    expect(legal).toContain('to="/suppression-compte"');
    expect(legal).not.toMatch(/old_value|storageKey|signed URL/i);
  });
});
