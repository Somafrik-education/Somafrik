import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canManageRolePermissions, canReadView, type PermissionContext } from "./permissions";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import { SUPER_ADMIN_ALLOWED_VIEWS } from "./superAdminAccess";
import type { SessionUser } from "../types";

const ROOT = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

function ctx(role: string, permissions: string[] = []): PermissionContext {
  return {
    user: {
      id: "u1",
      role,
      permissions,
      schoolCode: role === SUPER_ADMIN_ROLE ? "*" : "CD-2026-0001",
    } as SessionUser,
    rolePermissions: {},
    permissionsReady: true,
  };
}

describe("Administration — GREEN inventaire (faits actuels, pas un correctif)", () => {
  it("les 5 onglets Administration existent dans le layout", () => {
    const layout = read("../pages/administration/AdministrationLayout.tsx");
    expect(layout).toMatch(/to: "\/administration\/relations"/);
    expect(layout).toMatch(/to: "\/administration\/utilisateurs"/);
    expect(layout).toMatch(/to: "\/administration\/permissions"/);
    expect(layout).toMatch(/to: "\/administration\/documents"/);
    expect(layout).toMatch(/to: "\/administration\/conformite"/);
  });

  it("Superadmin ouvre Utilisateurs et Rôles/droits ; SCHOOL_ADMIN n'ouvre pas la matrice", () => {
    const superCtx = ctx(SUPER_ADMIN_ROLE, ["ALL_PRIVILEGES"]);
    expect(canReadView(superCtx, "users")).toBe(true);
    expect(canReadView(superCtx, "permissions")).toBe(true);
    expect(canReadView(superCtx, "relations")).toBe(true);
    expect(canManageRolePermissions(superCtx)).toBe(true);
    expect(canReadView(ctx(SCHOOL_ADMIN_ROLE, ["Utilisateurs:READ", "Gérer utilisateurs"]), "permissions")).toBe(
      false,
    );
  });

  it("faits d'accès : documents et reports hors SUPER_ADMIN_ALLOWED_VIEWS", () => {
    expect(SUPER_ADMIN_ALLOWED_VIEWS.has("users")).toBe(true);
    expect(SUPER_ADMIN_ALLOWED_VIEWS.has("permissions")).toBe(true);
    expect(SUPER_ADMIN_ALLOWED_VIEWS.has("relations")).toBe(true);
    expect(SUPER_ADMIN_ALLOWED_VIEWS.has("documents")).toBe(false);
    expect(SUPER_ADMIN_ALLOWED_VIEWS.has("reports")).toBe(false);
    expect(canReadView(ctx(SUPER_ADMIN_ROLE, ["ALL_PRIVILEGES"]), "documents")).toBe(false);
    expect(canReadView(ctx(SUPER_ADMIN_ROLE, ["ALL_PRIVILEGES"]), "reports")).toBe(false);
  });

  it("Conformité est ReportsPage + MVP_COVERAGE, sans client API", () => {
    const page = read("../pages/ReportsPage.tsx");
    expect(page).toMatch(/MVP_COVERAGE/);
    expect(page).toMatch(/Conformité MVP/);
    expect(page).not.toMatch(/api\.(get|post)|audit|erasure|reports\/advanced/);
    expect(read("../App.tsx")).toMatch(/path="conformite"[\s\S]*ReportsPage/);
  });

  it("Documents admin : API métadonnées school-documents, pas de binaire dans le client", () => {
    const api = read("./schoolDocumentsApi.ts");
    expect(api).toMatch(/\/school-documents/);
    expect(api).toMatch(/create:/);
    expect(api).toMatch(/archive:/);
    expect(api).not.toMatch(/upload|download|FormData|blob/);
  });

  it("Relations admin : createRelation existe, pas de delete/archive client", () => {
    const api = read("./clientsApi.ts");
    expect(api).toMatch(/listRelations/);
    expect(api).toMatch(/createRelation/);
    expect(api).not.toMatch(/deleteRelation|archiveRelation/);
  });

  it("Admin Pays peut ouvrir Conformité (Rapports) ; Superadmin non", () => {
    expect(canReadView(ctx(COUNTRY_ADMIN_ROLE, ["COUNTRY_PRIVILEGES"]), "reports")).toBe(true);
    expect(canReadView(ctx(SUPER_ADMIN_ROLE, ["ALL_PRIVILEGES"]), "reports")).toBe(false);
  });
});
