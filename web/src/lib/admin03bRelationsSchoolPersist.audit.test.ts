import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SessionUser } from "../types";
import { canArchiveParentRelation, canLinkParent, canReadView, hasBackOfficePermission, type PermissionContext } from "./permissions";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import { isSuperAdminAllowedFeature, isSuperAdminAllowedView } from "./superAdminAccess";
import { isWebSchoolDomainFeature } from "./webSchoolDomainDeny";

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
    permissions: ["Relations:READ", "Relations:CREATE", "Relations:UPDATE", "Gérer utilisateurs"],
    schoolCode: "CD-2026-0001",
  } as SessionUser;
}

describe("ADMIN-03B Relations — Option A UI", () => {
  it("Superadmin / Country Admin n'ouvrent plus Relations", () => {
    expect(isSuperAdminAllowedView("relations")).toBe(false);
    expect(isSuperAdminAllowedFeature("Relations")).toBe(false);
    expect(isWebSchoolDomainFeature("Relations")).toBe(true);
    expect(canReadView(ctx(superadmin()), "relations")).toBe(false);
    expect(canReadView(ctx(countryAdmin()), "relations")).toBe(false);
    expect(hasBackOfficePermission(ctx(superadmin()), "Relations", "READ")).toBe(false);
    expect(hasBackOfficePermission(ctx(countryAdmin()), "Relations", "READ")).toBe(false);
    expect(canLinkParent(ctx(superadmin()))).toBe(false);
    expect(canArchiveParentRelation(ctx(superadmin()))).toBe(false);
    expect(canLinkParent(ctx(countryAdmin()))).toBe(false);
  });

  it("School Admin conserve lecture / création / archivage", () => {
    expect(canReadView(ctx(schoolAdmin()), "relations")).toBe(true);
    expect(hasBackOfficePermission(ctx(schoolAdmin()), "Relations", "CREATE")).toBe(true);
    expect(canLinkParent(ctx(schoolAdmin()))).toBe(true);
    expect(canArchiveParentRelation(ctx(schoolAdmin()))).toBe(true);
  });

  it("AdministrationLayout masque uniquement Relations via canReadView", () => {
    const layout = readFileSync(join(ROOT, "../pages/administration/AdministrationLayout.tsx"), "utf8");
    expect(layout).toContain('tab.to !== "/administration/relations"');
    expect(layout).toContain('canReadView(ctx, "relations")');
    expect(layout).not.toContain("canReadView(ctx, tab.view)");
    expect(layout).toContain('view: "relations"');
    expect(layout).toContain('to: "/administration/documents"');
    expect(layout).toContain('to: "/administration/conformite"');
    expect(layout).toContain('to: "/administration/utilisateurs"');
    expect(layout).toContain('to: "/administration/permissions"');
  });

  it("EntityPage persist update/archive et plus de delete local Relations", () => {
    const entityPage = readFileSync(join(ROOT, "../pages/EntityPage.tsx"), "utf8");
    expect(entityPage).toContain("clientsApi.updateRelation");
    expect(entityPage).toContain("clientsApi.archiveRelation");
    expect(entityPage).toContain("Aucune suppression physique");
    expect(entityPage).not.toContain("buildRelationDeleteAuditEntry");
    const clientsApi = readFileSync(join(ROOT, "clientsApi.ts"), "utf8");
    expect(clientsApi).toContain("updateRelation");
    expect(clientsApi).toContain("/archive");
  });
});
