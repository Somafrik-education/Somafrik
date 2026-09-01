import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PermissionContext } from "./permissions";
import { canLoadDomain, layoutDomainsForContext } from "./domainPermissions";
import { domainsForPath } from "./routeDomainMap";
import { canReadView } from "./permissions";

const here = dirname(fileURLToPath(import.meta.url));

const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEFTOVER_A = "CD-2026-0001";

function schoolAdminCtx(permissions: string[]): PermissionContext {
  return {
    user: {
      id: "admin-nuru",
      role: "Admin School",
      schoolCode: LEFTOVER_A,
      schoolId: SCHOOL_ID_A,
      schoolPublicCode: "CD-IN-26-001",
      permissions,
    },
    rolePermissions: {},
  };
}

const SCHOOL_ADMIN_PREPROD = schoolAdminCtx([
  "Utilisateurs:READ",
  "Classes:READ",
  "Élèves:READ",
  "Enseignants:READ",
  "Notifications:READ",
  "Paramètres Établissement:READ",
  "Paiements:READ",
  "Présences:READ",
  "Notes:READ",
]);

describe("P1 RBAC parity — SCHOOL_ADMIN /etablissement/vue-ensemble", () => {
  it("H. Web schools = GET :code (Paramètres Établissement), pas le catalogue Établissements:READ", () => {
    expect(canReadView(SCHOOL_ADMIN_PREPROD, "schools")).toBe(false);
    expect(canReadView(SCHOOL_ADMIN_PREPROD, "configuration")).toBe(true);
    expect(canLoadDomain(SCHOOL_ADMIN_PREPROD, "schools")).toBe(true);

    const rbac = readFileSync(join(here, "../../../backend/services/rbacService.js"), "utf8");
    expect(rbac).toMatch(
      /"GET \/api\/backoffice\/establishments": \["Établissements:READ"/,
    );
    expect(rbac).toMatch(
      /"GET \/api\/backoffice\/establishments\/:code": \[[^\]]*"Paramètres Établissement:READ"/,
    );
    expect(rbac).not.toMatch(
      /"GET \/api\/backoffice\/establishments": \[[^\]]*"Paramètres Établissement:READ"/,
    );
  });

  it("H. Web notifications plateforme = Super/Pays ; Notifications:READ n'ouvre pas GET /notifications", () => {
    expect(canReadView(SCHOOL_ADMIN_PREPROD, "notifications")).toBe(true);
    expect(canLoadDomain(SCHOOL_ADMIN_PREPROD, "notifications")).toBe(false);
    expect(layoutDomainsForContext(SCHOOL_ADMIN_PREPROD)).not.toContain("notifications");

    const rbac = readFileSync(join(here, "../../../backend/services/rbacService.js"), "utf8");
    expect(rbac).toMatch(
      /"GET \/api\/backoffice\/notifications": \["ALL_PRIVILEGES", "COUNTRY_PRIVILEGES"\]/,
    );
    expect(rbac).toMatch(
      /"GET \/api\/backoffice\/internal-notifications": \["Notifications:READ"/,
    );
  });

  it("H. subscription-access SCHOOL_ADMIN = Paramètres Établissement:READ", () => {
    const rbac = readFileSync(join(here, "../../../backend/services/rbacService.js"), "utf8");
    expect(rbac).toMatch(
      /"GET \/api\/backoffice\/subscription-access": \[[\s\S]*Paramètres Établissement:READ/,
    );
  });

  it("I. /etablissement/vue-ensemble ne charge pas le catalogue notifications plateforme", () => {
    const domains = domainsForPath("/etablissement/vue-ensemble", SCHOOL_ADMIN_PREPROD);
    expect(domains).toContain("schools");
    expect(domains).toContain("users");
    expect(domains).not.toContain("notifications");
  });
});
