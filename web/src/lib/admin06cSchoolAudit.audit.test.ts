import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SessionUser } from "../types";
import { canReadView, getCurrentRolePermissions, hasBackOfficePermission, type PermissionContext } from "./permissions";
import { SCHOOL_ADMIN_ROLE } from "./orgHierarchy";
import { isSchoolAdminRole } from "./format";

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

function canReadAudit(context: PermissionContext): boolean {
  return (
    isSchoolAdminRole(context.user?.role) &&
    getCurrentRolePermissions(context).includes("Audit:READ")
  );
}

describe("ADMIN-06C journal d’audit school-only — API / permissions", () => {
  it("C06C-20 / C06C-23 Rapports:READ seul n’accorde pas Audit", () => {
    const reportsOnly = ctx(schoolUser(["Rapports:READ"]));
    expect(canReadView(reportsOnly, "reports")).toBe(true);
    expect(canReadAudit(reportsOnly)).toBe(false);
    expect(hasBackOfficePermission(reportsOnly, "Audit", "READ")).toBe(false);
  });

  it("C06C-21 SCHOOL_ADMIN + Audit:READ ouvre le journal", () => {
    const allowed = ctx(schoolUser(["Rapports:READ", "Audit:READ"]));
    expect(canReadAudit(allowed)).toBe(true);
    expect(canReadView(allowed, "reports")).toBe(true);
  });

  it("C06C-05 / C06C-23 Audit:READ sur rôle non-SCHOOL_ADMIN n’ouvre pas le journal", () => {
    expect(canReadAudit(ctx(schoolUser(["Audit:READ"], "Secrétaire")))).toBe(false);
    expect(canReadAudit(ctx(schoolUser(["Audit:READ"], "Proviseur")))).toBe(false);
    expect(canReadAudit(ctx(schoolUser(["Audit:READ"], "Enseignant")))).toBe(false);
  });

  it("C06C API web n’accepte aucun schoolCode / userId", () => {
    const api = readFileSync(join(ROOT, "schoolAuditApi.ts"), "utf8");
    expect(api).toContain('return query ? `/audit?${query}` : "/audit"');
    expect(api).toContain("params.set(\"action\"");
    expect(api).toContain("params.set(\"from\"");
    expect(api).toContain("params.set(\"to\"");
    expect(api).toContain("params.set(\"limit\"");
    expect(api).toContain("params.set(\"offset\"");
    expect(api).not.toMatch(/schoolCode|schoolId|userId|actorUserId/);
    expect(api).not.toMatch(/\?schoolCode=/);
  });

  it("C06C dashboard permission = SCHOOL_ADMIN ET Audit:READ exact", () => {
    const dashboard = readFileSync(join(ROOT, "../pages/SchoolComplianceDashboard.tsx"), "utf8");
    expect(dashboard).toContain("isSchoolAdminRole(ctx.user?.role)");
    expect(dashboard).toContain('getCurrentRolePermissions(ctx).includes("Audit:READ")');
    expect(dashboard).toContain("listSchoolAuditSummaries");
    expect(dashboard).toContain("Journal d’audit");
    expect(dashboard).toContain("Aucune activité d’audit.");
    expect(dashboard).not.toMatch(/Les journaux d’audit établissement ne sont pas encore exposés/);
    expect(dashboard).not.toMatch(/oldValue|newValue|ipAddress|userAgent/);
  });

  it("C06C-24 A1 ReportsPage reste inchangé", () => {
    const page = readFileSync(join(ROOT, "../pages/ReportsPage.tsx"), "utf8");
    expect(page).toContain("PlatformComplianceDashboard");
    expect(page).toContain("SchoolComplianceDashboard");
    expect(page).toContain("getPlatformCompliance");
    expect(page).not.toMatch(/\/api\/audit|listSchoolAuditSummaries/);
  });
});
