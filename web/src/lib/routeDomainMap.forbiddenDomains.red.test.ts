/**
 * P0 [RED] — LOT RED-4 / RED-5
 * Matrice rôles × domaines réellement déclarés dans le Web.
 * Un rôle sans Messages:READ / Announcements:READ ne doit pas hydrater
 * ces domaines juste pour afficher un dashboard ou Paramètres.
 */
import { describe, expect, it } from "vitest";
import { DOMAIN_KEYS, type DomainKey } from "./domainLoaders";
import { canLoadDomain, layoutDomainsForContext } from "./domainPermissions";
import { domainsForPath } from "./routeDomainMap";
import {
  canReadView,
  hasBackOfficePermission,
  type PermissionContext,
} from "./permissions";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import { getInternalRoleDefaults } from "./internalRoleDefaults";
import {
  permissionsForRole,
  schoolCodeForRole,
  sessionUserForRole,
  WEB_ROLE_CATALOG,
} from "../context/forbiddenDomainRedTestUtils";

const AUDIT_PATHS = [
  "/tableau-de-bord",
  "/parametres",
  "/etablissement/vue-ensemble",
  "/notes",
] as const;

function ctxForRole(role: string, permissions = permissionsForRole(role)): PermissionContext {
  return {
    user: sessionUserForRole(role, { permissions }),
    rolePermissions: {},
    permissionsReady: true,
    permissionsBootstrap: "ready",
  };
}

describe("P0 [RED] — matrice rôles × domaines (chargements excessifs)", () => {
  it("[RED] RED-4 / RED-5 un rôle sans Messages:READ ne doit pas hydrater messages sur le tableau de bord", () => {
    const teacherWithoutMessages = ctxForRole("Enseignant", [
      "Notes:READ",
      "Élèves:READ",
      "Présences:READ",
    ]);
    expect(hasBackOfficePermission(teacherWithoutMessages, "Messages", "READ")).toBe(false);
    expect(layoutDomainsForContext(teacherWithoutMessages)).not.toContain("messages");
    expect(domainsForPath("/tableau-de-bord", teacherWithoutMessages)).not.toContain("messages");
    expect(canLoadDomain(teacherWithoutMessages, "messages")).toBe(false);
  });

  it("[CONTROL] RED-5 Enseignant sans Announcements:READ ne charge pas announcements pour afficher /notes", () => {
    const teacherWithoutAnnouncements = ctxForRole("Enseignant", [
      "Notes:READ",
      "Notes:CREATE",
      "Élèves:READ",
    ]);
    expect(hasBackOfficePermission(teacherWithoutAnnouncements, "Announcements", "READ")).toBe(false);
    expect(domainsForPath("/notes", teacherWithoutAnnouncements)).not.toContain("announcements");
    expect(layoutDomainsForContext(teacherWithoutAnnouncements)).not.toContain("announcements");
  });

  it("[RED] RED-5 Parent sans Messages:READ ne charge pas messages pour le dashboard", () => {
    const parent = ctxForRole("Parent", ["Élèves:READ", "Notes:READ", "Bulletins:READ"]);
    expect(hasBackOfficePermission(parent, "Messages", "READ")).toBe(false);
    expect(domainsForPath("/tableau-de-bord", parent)).not.toContain("messages");
    expect(canLoadDomain(parent, "messages")).toBe(false);
  });

  it("[RED] RED-5 Élève sans Messages:READ ne charge pas messages pour le dashboard", () => {
    const student = ctxForRole("Élève / Étudiant", ["Notes:READ", "Bulletins:READ"]);
    expect(hasBackOfficePermission(student, "Messages", "READ")).toBe(false);
    expect(domainsForPath("/tableau-de-bord", student)).not.toContain("messages");
  });

  it("[RED] RED-5 Surveillant (aucun default Messages) ne doit pas hydrater messages/annonces", () => {
    const supervisor = ctxForRole("Surveillant", []);
    expect(getInternalRoleDefaults("Surveillant")).toEqual([]);
    expect(hasBackOfficePermission(supervisor, "Messages", "READ")).toBe(false);
    expect(hasBackOfficePermission(supervisor, "Announcements", "READ")).toBe(false);
    expect(layoutDomainsForContext(supervisor)).not.toContain("messages");
    expect(layoutDomainsForContext(supervisor)).not.toContain("announcements");
    expect(domainsForPath("/tableau-de-bord", supervisor)).not.toContain("messages");
    expect(domainsForPath("/parametres", supervisor)).not.toContain("announcements");
  });

  it("[RED] RED-7 /parametres n'a pas besoin de messages ni announcements pour rester affichable", () => {
    const schoolAdmin = ctxForRole(SCHOOL_ADMIN_ROLE);
    const domains = domainsForPath("/parametres", schoolAdmin);
    expect(domains).toContain("academicConfigs");
    expect(domains).not.toContain("messages");
    expect(domains).not.toContain("announcements");
  });

  it("[RED] RED-5 Super Admin / Admin Pays : /parametres ne doit pas hydrater les domaines établissement messages/announcements", () => {
    for (const role of [SUPER_ADMIN_ROLE, COUNTRY_ADMIN_ROLE]) {
      const ctx = ctxForRole(role);
      const domains = domainsForPath("/parametres", ctx);
      expect(domains, `${role} /parametres`).not.toContain("messages");
      expect(domains, `${role} /parametres`).not.toContain("announcements");
    }
  });

  it("[AUDIT] RED-4 catalogue Web : chaque rôle a des domaines légitimes et des domaines sans droit", () => {
    const rows: Array<{
      role: string;
      schoolCode: string;
      path: string;
      domain: DomainKey;
      canRead: boolean;
      requested: boolean;
      excessive: boolean;
    }> = [];

    for (const role of WEB_ROLE_CATALOG) {
      const ctx = ctxForRole(role);
      expect(ctx.user?.role).toBe(role);
      expect(schoolCodeForRole(role)).toBe(ctx.user?.schoolCode);

      for (const path of AUDIT_PATHS) {
        const requested = new Set(domainsForPath(path, ctx));
        for (const domain of DOMAIN_KEYS) {
          const canRead = canLoadDomain(ctx, domain);
          const isRequested = requested.has(domain);
          rows.push({
            role,
            schoolCode: String(ctx.user?.schoolCode),
            path,
            domain,
            canRead,
            requested: isRequested,
            excessive: isRequested && !canRead,
          });
        }
      }
    }

    const excessive = rows.filter((row) => row.excessive);
    expect(
      excessive,
      `chargements sans canLoadDomain: ${excessive.map((row) => `${row.role} ${row.path} ${row.domain}`).join(", ")}`,
    ).toEqual([]);

    const dashboardMessagesWithoutGrant = WEB_ROLE_CATALOG.filter((role) => {
      const ctx = ctxForRole(role);
      const requested = domainsForPath("/tableau-de-bord", ctx).includes("messages");
      const grant = hasBackOfficePermission(ctx, "Messages", "READ");
      const establishmentBypass = canReadView(ctx, "messages") && !grant;
      return requested && (establishmentBypass || !grant);
    });

    expect(
      dashboardMessagesWithoutGrant,
      "des rôles sans Messages:READ déclenchent quand même GET messages via le layout",
    ).toEqual([]);
  });
});
