import { afterEach, describe, expect, it } from "vitest";
import { visibleNavItemsForRole } from "./useVisibleNavItems";
import type { PermissionContext } from "../../lib/permissions";
import { canReadView } from "../../lib/permissions";
import {
  CUSTOM_SCHOOL_ROLE_WEB_PROFILE,
  isCustomSchoolRoleSessionUser,
  isRegisteredCustomSchoolRole,
  syncCustomSchoolRoleSession,
} from "../../lib/customSchoolRoleSession";
import { isInternalSchoolRole } from "../../lib/format";

const CUSTOM_ROLE = "CONSEILLER_PÉDAGOGIQUE";

function customContext(
  permissions: string[],
  overrides: Partial<{ role: string; schoolCode: string; webAccessProfile?: string }> = {},
): PermissionContext {
  return {
    user: {
      id: "custom-1",
      role: CUSTOM_ROLE,
      schoolCode: "CD-RLA-26-001",
      permissions,
      webAccessProfile: CUSTOM_SCHOOL_ROLE_WEB_PROFILE,
      ...overrides,
    } as PermissionContext["user"],
    rolePermissions: {},
    permissionsReady: true,
  };
}

afterEach(() => syncCustomSchoolRoleSession(null));

describe("RBAC-LOGIN-01 — rôle personnalisé d'établissement (Web)", () => {
  it("sans validation serveur, un rôle inconnu n'est jamais un rôle interne d'établissement", () => {
    syncCustomSchoolRoleSession(null);
    expect(isInternalSchoolRole(CUSTOM_ROLE)).toBe(false);
    const ctx = customContext(["Classes:READ"], { webAccessProfile: undefined });
    syncCustomSchoolRoleSession(ctx.user);
    expect(isRegisteredCustomSchoolRole(CUSTOM_ROLE)).toBe(false);
    expect(visibleNavItemsForRole(ctx, CUSTOM_ROLE).some((item) => item.path === "/classes")).toBe(false);
  });

  it("navigation scolaire limitée aux permissions effectives", () => {
    const ctx = customContext(["Classes:READ", "Présences:READ"]);
    syncCustomSchoolRoleSession(ctx.user);
    const paths = visibleNavItemsForRole(ctx, CUSTOM_ROLE).map((item) => item.path);
    // Classes : onglet du hub « Mon établissement » ; Présences : module dédié.
    expect(paths).toEqual(expect.arrayContaining(["/tableau-de-bord", "/etablissement", "/presences"]));
    for (const forbidden of ["/notes", "/examens", "/bulletins", "/finances", "/planning", "/pays", "/etablissements", "/abonnements", "/parametres", "/administration"]) {
      expect(paths).not.toContain(forbidden);
    }
    expect(canReadView(ctx, "classes")).toBe(true);
    expect(canReadView(ctx, "students")).toBe(false);
    expect(canReadView(ctx, "teachers")).toBe(false);
  });

  it("aucun module métier sans permission", () => {
    const ctx = customContext([]);
    syncCustomSchoolRoleSession(ctx.user);
    const paths = visibleNavItemsForRole(ctx, CUSTOM_ROLE).map((item) => item.path);
    expect(paths.every((path) => ["/tableau-de-bord", "/etablissement"].includes(path))).toBe(true);
    for (const view of ["classes", "students", "teachers", "presences", "notes", "payments", "configuration", "settings", "permissions"]) {
      expect(canReadView(ctx, view)).toBe(false);
    }
  });

  it("jamais pour un rôle plateforme, Parent, Élève ou un compte sans établissement", () => {
    for (const role of ["Super Administrateur Somafrik", "Admin Pays", "Parent", "Élève / Étudiant", "Sans affectation"]) {
      const ctx = customContext(["Classes:READ"], { role });
      expect(isCustomSchoolRoleSessionUser(ctx.user)).toBe(false);
    }
    expect(isCustomSchoolRoleSessionUser(customContext([], { schoolCode: "*" }).user)).toBe(false);
    expect(isCustomSchoolRoleSessionUser(customContext([], { schoolCode: "" }).user)).toBe(false);
  });

  it("le registre suit la session (déconnexion = retrait)", () => {
    const ctx = customContext(["Classes:READ"]);
    syncCustomSchoolRoleSession(ctx.user);
    expect(isInternalSchoolRole(CUSTOM_ROLE)).toBe(true);
    syncCustomSchoolRoleSession(null);
    expect(isInternalSchoolRole(CUSTOM_ROLE)).toBe(false);
  });

  it("aucune régression des rôles système", () => {
    syncCustomSchoolRoleSession(null);
    expect(isInternalSchoolRole("Enseignant")).toBe(true);
    expect(isInternalSchoolRole("Admin School")).toBe(true);
    expect(isInternalSchoolRole("Super Administrateur Somafrik")).toBe(false);
    expect(isInternalSchoolRole("Admin Pays")).toBe(false);
  });
});
