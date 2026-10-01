import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SessionUser } from "../types";
import { canLinkParent, canReadView, hasBackOfficePermission, type PermissionContext } from "./permissions";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import { isSuperAdminAllowedFeature, isSuperAdminAllowedView } from "./superAdminAccess";
import { isWebSchoolDomainFeature, shouldDenyWebSchoolDomain } from "./webSchoolDomainDeny";
import { stripClientClientsFromPutPayload } from "./stripClientClients";

const ROOT = dirname(fileURLToPath(import.meta.url));

function ctx(user: Partial<SessionUser>): PermissionContext {
  return {
    user: user as SessionUser,
    rolePermissions: {},
    permissionsReady: true,
  };
}

function superadmin(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "super-1",
    firstName: "Super",
    lastName: "Admin",
    identifier: "super-1",
    role: SUPER_ADMIN_ROLE,
    permissions: ["ALL_PRIVILEGES"],
    schoolCode: "*",
    ...overrides,
  } as SessionUser;
}

function countryAdmin(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "pays-1",
    firstName: "Admin",
    lastName: "Pays",
    identifier: "pays-1",
    role: COUNTRY_ADMIN_ROLE,
    permissions: ["COUNTRY_PRIVILEGES"],
    schoolCode: "*",
    ...overrides,
  } as SessionUser;
}

function schoolAdmin(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "admin-nuru",
    firstName: "Admin",
    lastName: "Nuru",
    identifier: "admin-nuru",
    role: SCHOOL_ADMIN_ROLE,
    permissions: ["Relations:READ", "Relations:CREATE", "Gérer utilisateurs"],
    schoolCode: "CD-2026-0001",
    ...overrides,
  } as SessionUser;
}

describe("ADMIN-03A Relations — incohérence UI vs barrière API", () => {
  it("REL-01 SUPER_ADMIN ouvre l'onglet Relations (façade UI actuelle)", () => {
    expect(isSuperAdminAllowedView("relations")).toBe(true);
    expect(isSuperAdminAllowedFeature("Relations")).toBe(true);
    expect(canReadView(ctx(superadmin()), "relations")).toBe(true);
    expect(hasBackOfficePermission(ctx(superadmin()), "Relations", "READ")).toBe(true);
    expect(canLinkParent(ctx(superadmin()))).toBe(true);
    expect(shouldDenyWebSchoolDomain(superadmin())).toBe(true);
    expect(isWebSchoolDomainFeature("Relations")).toBe(false);
    expect(isWebSchoolDomainFeature("Messages")).toBe(true);
  });

  it("COUNTRY_ADMIN peut aussi ouvrir Relations côté UI (même façade)", () => {
    expect(canReadView(ctx(countryAdmin()), "relations")).toBe(true);
    expect(hasBackOfficePermission(ctx(countryAdmin()), "Relations", "READ")).toBe(true);
    expect(canLinkParent(ctx(countryAdmin()))).toBe(true);
  });

  it("SCHOOL_ADMIN lit / crée Relations côté UI", () => {
    expect(canReadView(ctx(schoolAdmin()), "relations")).toBe(true);
    expect(hasBackOfficePermission(ctx(schoolAdmin()), "Relations", "CREATE")).toBe(true);
  });

  it("AdministrationLayout liste Relations sans filtre de rôle", () => {
    const layout = readFileSync(join(ROOT, "../pages/administration/AdministrationLayout.tsx"), "utf8");
    expect(layout).toContain('to: "/administration/relations"');
    expect(layout).toContain('label: "Relations"');
    expect(layout).not.toMatch(/ADMINISTRATION_TABS.*filter/);
  });

  it("EntityPage Relations : create POST uniquement ; delete Admin local / archive parents", () => {
    const entityPage = readFileSync(join(ROOT, "../pages/EntityPage.tsx"), "utf8");
    expect(entityPage).toContain("clientsApi.createRelation");
    expect(entityPage).not.toContain("clientsApi.updateRelation");
    expect(entityPage).not.toContain("clientsApi.deleteRelation");
    expect(entityPage).toContain("parentsApi.archiveRelation");
    expect(entityPage).toContain("buildRelationDeleteAuditEntry");
    const clientsApi = readFileSync(join(ROOT, "clientsApi.ts"), "utf8");
    expect(clientsApi).toContain("listRelations");
    expect(clientsApi).toContain("createRelation");
    expect(clientsApi).not.toMatch(/updateRelation|deleteRelation|patchRelation/);
  });

  it("PUT state ne persiste pas relations (stripClientClients)", () => {
    const stripped = stripClientClientsFromPutPayload({
      relations: [{ id: "rel-1", fromContactName: "Awa" }],
      users: [{ id: "u-1" }],
      classes: [{ id: "c-1" }],
    });
    expect("relations" in stripped).toBe(false);
    expect("users" in stripped).toBe(false);
    expect(stripped.classes).toEqual([{ id: "c-1" }]);
  });
});
