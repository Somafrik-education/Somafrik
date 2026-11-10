import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SessionUser } from "../types";
import { canReadView, type PermissionContext } from "./permissions";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import { isSuperAdminAllowedFeature, isSuperAdminAllowedView } from "./superAdminAccess";

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
    permissions: ["Documents:READ", "Documents:CREATE", "Documents:UPDATE"],
    schoolCode: "CD-2026-0001",
  } as SessionUser;
}

describe("ADMIN-05A Documents — Option A school-only UI", () => {
  it("D05-01 Superadmin ne voit pas l'onglet Documents", () => {
    expect(isSuperAdminAllowedView("documents")).toBe(false);
    expect(isSuperAdminAllowedFeature("Documents")).toBe(false);
    expect(canReadView(ctx(superadmin()), "documents")).toBe(false);
    const layout = readFileSync(join(ROOT, "../pages/administration/AdministrationLayout.tsx"), "utf8");
    expect(layout).toContain("canReadView(ctx, tab.view)");
    const access = readFileSync(join(ROOT, "superAdminAccess.ts"), "utf8");
    expect(access).not.toMatch(/SUPER_ADMIN_ALLOWED_VIEWS[\s\S]*documents/);
    expect(access).not.toContain('"Documents"');
  });

  it("D05-04 Country Admin n'ouvre pas Documents établissement", () => {
    expect(canReadView(ctx(countryAdmin()), "documents")).toBe(false);
  });

  it("D05-05 School Admin autorisé voit Documents", () => {
    expect(canReadView(ctx(schoolAdmin()), "documents")).toBe(true);
  });

  it("D05-17 schoolDocumentsApi n'expose ni storageKey ni download", () => {
    const api = readFileSync(join(ROOT, "schoolDocumentsApi.ts"), "utf8");
    expect(api).toContain("CanonicalSchoolDocument");
    expect(api).toContain("schoolId");
    expect(api).toContain("mimeType");
    expect(api).not.toContain("storageKey");
    expect(api).not.toMatch(/download|upload/);
    const entity = readFileSync(join(ROOT, "../pages/EntityPage.tsx"), "utf8");
    expect(entity).toContain("schoolDocumentsApi.patch");
    expect(entity).toContain("schoolDocumentsApi.create");
    expect(entity).toContain("schoolDocumentsApi.archive");
    expect(entity).toContain("await refresh()");
  });
});
