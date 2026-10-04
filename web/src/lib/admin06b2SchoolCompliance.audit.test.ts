import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SessionUser } from "../types";
import { canReadView, hasBackOfficePermission, type PermissionContext } from "./permissions";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";

const ROOT = dirname(fileURLToPath(import.meta.url));

function ctx(user: Partial<SessionUser>): PermissionContext {
  return {
    user: user as SessionUser,
    rolePermissions: {},
    permissionsReady: true,
  };
}

function schoolUser(permissions: string[], role = SCHOOL_ADMIN_ROLE): SessionUser {
  return {
    id: "school-1",
    identifier: "school-1",
    role,
    permissions,
    schoolCode: "CD-2026-0001",
  } as SessionUser;
}

describe("ADMIN-06B2 Conformité établissement A2", () => {
  it("C06B2-01 Superadmin conserve dashboard A1", () => {
    const page = readFileSync(join(ROOT, "../pages/ReportsPage.tsx"), "utf8");
    expect(page).toContain("PlatformComplianceDashboard");
    expect(page).toContain("getPlatformCompliance");
    expect(canReadView(ctx({
      id: "s",
      role: SUPER_ADMIN_ROLE,
      permissions: ["ALL_PRIVILEGES"],
      schoolCode: "*",
    } as SessionUser), "reports")).toBe(true);
  });

  it("C06B2-02 COUNTRY_ADMIN canReadView(reports) = false", () => {
    expect(canReadView(ctx({
      id: "p",
      role: COUNTRY_ADMIN_ROLE,
      permissions: ["COUNTRY_PRIVILEGES"],
      schoolCode: "*",
    } as SessionUser), "reports")).toBe(false);
  });

  it("C06B2-03 School Admin ouvre SchoolComplianceDashboard", () => {
    expect(canReadView(ctx(schoolUser(["Rapports:READ"])), "reports")).toBe(true);
    const page = readFileSync(join(ROOT, "../pages/ReportsPage.tsx"), "utf8");
    expect(page).toContain("SchoolComplianceDashboard");
    expect(page).not.toContain("MVP_COVERAGE");
  });

  it("C06B2-08 / C06B2-09 / C06B2-10 / C06B2-20 / C06B2-21 permissions sous-fonctions", () => {
    const reportsOnly = ctx(schoolUser(["Rapports:READ"]));
    expect(hasBackOfficePermission(reportsOnly, "Utilisateurs", "READ")).toBe(false);
    expect(hasBackOfficePermission(reportsOnly, "Utilisateurs", "UPDATE")).toBe(false);
    expect(canReadView(reportsOnly, "dataExport")).toBe(false);

    const readOnly = ctx(schoolUser(["Rapports:READ", "Utilisateurs:READ"]));
    expect(hasBackOfficePermission(readOnly, "Utilisateurs", "READ")).toBe(true);
    expect(hasBackOfficePermission(readOnly, "Utilisateurs", "UPDATE")).toBe(false);

    const teacherReports = ctx(schoolUser(["Rapports:READ"], "Enseignant"));
    expect(canReadView(teacherReports, "reports")).toBe(true);
    expect(canReadView(teacherReports, "dataExport")).toBe(false);

    const dashboard = readFileSync(join(ROOT, "../pages/SchoolComplianceDashboard.tsx"), "utf8");
    expect(dashboard).toContain('hasBackOfficePermission(ctx, "Utilisateurs", "READ")');
    expect(dashboard).toContain('hasBackOfficePermission(ctx, "Utilisateurs", "UPDATE")');
    expect(dashboard).toContain('canReadView(ctx, "dataExport")');
    expect(dashboard).toContain("if (!canListPrivacy)");
    expect(dashboard).toContain("listSchoolErasureRequests");
  });

  it("EX06B2-10 SCHOOL_ADMIN sans Paramètres READ/UPDATE → dataExport false", () => {
    expect(canReadView(ctx(schoolUser(["Rapports:READ", "ALL_PRIVILEGES"])), "dataExport")).toBe(false);
  });

  it("EX06B2-11 SCHOOL_ADMIN + Paramètres READ → dataExport true", () => {
    expect(canReadView(ctx(schoolUser(["Paramètres Établissement:READ"])), "dataExport")).toBe(true);
  });

  it("EX06B2-12 SCHOOL_ADMIN + Paramètres UPDATE → dataExport true", () => {
    expect(canReadView(ctx(schoolUser(["Paramètres Établissement:UPDATE"])), "dataExport")).toBe(true);
  });

  it("EX06B2-13 Proviseur + Paramètres READ → dataExport false", () => {
    expect(canReadView(ctx(schoolUser(["Paramètres Établissement:READ"], "Proviseur")), "dataExport")).toBe(false);
  });

  it("C06B2 API web n'accepte aucun schoolCode client", () => {
    const api = readFileSync(join(ROOT, "schoolComplianceApi.ts"), "utf8");
    expect(api).toContain('api.get<SchoolErasureRequest[]>("/privacy/erasure-requests")');
    expect(api).toContain("encodeURIComponent(requestId)");
    expect(api).toContain('api.get<SchoolDataExportPayload>("/data-export")');
    expect(api).not.toMatch(/function .*\(.*schoolCode|function .*\(.*schoolId|function .*\(.*countryCode/);
    expect(api).not.toMatch(/\?schoolCode=|headers[\s\S]*schoolCode/);
  });
});
