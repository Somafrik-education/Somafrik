/**
 * P1-09 — Replay final de fermeture sécurité (Web).
 * Aucune correction produit : invariants P1-07 + résiduels ALL_PRIVILEGES seul.
 */
import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canReadView, hasBackOfficePermission, type PermissionContext } from "./permissions";
import { isSuperAdminAllowedView } from "./superAdminAccess";
import { canLoadDomain } from "./domainPermissions";
import { pickInitialSchoolCode, withSchoolScope } from "./activeSchool";
import { projectScopedStudents } from "./studentsScope";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import {
  hasWebInternalNotificationScope,
  resolveWebNotificationsHref,
  shouldDenyWebSchoolDomain,
} from "./webSchoolDomainDeny";
import { hasCommunicationSchoolScope } from "./communicationSchoolScope";
import type { SessionUser } from "../types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STORAGE_KEY = "somafrik.activeSchoolCode";

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
    id: "admin-1",
    firstName: "Admin",
    lastName: "School",
    identifier: "admin-1",
    role: SCHOOL_ADMIN_ROLE,
    permissions: ["Élèves:READ", "Messages:READ", "Paiements:READ", "Notes:READ", "Présences:READ"],
    schoolCode: "CD-2026-0001",
  } as SessionUser;
}

function teacher(): SessionUser {
  return {
    id: "ens-1",
    firstName: "Ens",
    lastName: "Nkomo",
    identifier: "ens-1",
    role: "Enseignant",
    permissions: ["Élèves:READ", "Notes:READ", "Présences:READ"],
    schoolCode: "CD-2026-0001",
  } as SessionUser;
}

function parent(): SessionUser {
  return {
    id: "par-1",
    firstName: "Parent",
    lastName: "Okito",
    identifier: "par-1",
    role: "Parent",
    permissions: ["Élèves:READ", "Notifications:READ"],
    schoolCode: "CD-2026-0001",
  } as SessionUser;
}

/** Principal sans rôle plateforme ni scolaire, jeton ALL_PRIVILEGES (P1-01). */
const allPrivilegesOnly = {
  id: "priv-1",
  firstName: "Priv",
  lastName: "Only",
  identifier: "priv-1",
  role: "Agent",
  permissions: ["ALL_PRIVILEGES"],
  schoolCode: "*",
} as SessionUser;

describe("P1-09 Web — Superadmin / Admin Pays : zéro voie scolaire", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("Students / Notes / Présences / Finance / Messages / Planning / C4 / export fermés", () => {
    const superCtx = ctx(superadmin());
    const paysCtx = ctx(countryAdmin());
    for (const view of ["students", "notes", "presences", "payments", "messages", "planning", "dataExport"] as const) {
      expect(canReadView(superCtx, view)).toBe(false);
      expect(canReadView(paysCtx, view)).toBe(false);
    }
    expect(isSuperAdminAllowedView("students")).toBe(false);
    expect(isSuperAdminAllowedView("messages")).toBe(false);
    expect(canLoadDomain(superCtx, "students")).toBe(false);
    expect(canLoadDomain(superCtx, "messages")).toBe(false);
    expect(canLoadDomain(paysCtx, "payments")).toBe(false);
    expect(hasBackOfficePermission(superCtx, "Messages", "READ")).toBe(false);
    expect(hasWebInternalNotificationScope(superadmin(), "CD-2026-0001")).toBe(false);
    expect(hasCommunicationSchoolScope("CD-2026-0001", superadmin())).toBe(false);
    expect(resolveWebNotificationsHref(superadmin())).toBe("/notifications-plateforme");
    expect(pickInitialSchoolCode(superadmin(), ["CD-IN-26-001", "BI-EC-26-001"])).toBe("");
    expect(withSchoolScope(superadmin(), "CD-IN-26-001")?.schoolCode).toBe("*");
    expect(
      projectScopedStudents(superadmin(), {
        students: [{ id: "stu-1", schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
      }).students,
    ).toEqual([]);
  });

  it("fonctions plateforme conservées", () => {
    const superCtx = ctx(superadmin());
    expect(canReadView(superCtx, "overview")).toBe(true);
    expect(canReadView(superCtx, "users")).toBe(true);
    expect(canReadView(superCtx, "schools")).toBe(true);
    expect(canReadView(superCtx, "notifications")).toBe(true);
    expect(canReadView(superCtx, "announcements")).toBe(true);
  });

  it("Admin School / Teacher / Parent conservent le scolaire", () => {
    expect(canReadView(ctx(schoolAdmin()), "students")).toBe(true);
    expect(canReadView(ctx(schoolAdmin()), "messages")).toBe(true);
    expect(canReadView(ctx(schoolAdmin()), "dataExport")).toBe(true);
    expect(canReadView(ctx(teacher()), "students")).toBe(true);
    expect(canReadView(ctx(parent()), "students")).toBe(true);
    expect(shouldDenyWebSchoolDomain(schoolAdmin())).toBe(false);
    expect(shouldDenyWebSchoolDomain(teacher())).toBe(false);
  });
});

describe("P1-09 Web — ALL_PRIVILEGES / schoolCode * sans rôle plateforme", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("P1-07 deny reste role-only : ALL_PRIVILEGES seul n'est pas Superadmin", () => {
    expect(shouldDenyWebSchoolDomain(allPrivilegesOnly)).toBe(false);
    expect(shouldDenyWebSchoolDomain({ ...allPrivilegesOnly, role: "" })).toBe(false);
    expect(shouldDenyWebSchoolDomain(schoolAdmin())).toBe(false);
  });

  it("RESIDUEL : ALL_PRIVILEGES seul + * auto-sélectionne encore un établissement", () => {
    expect(pickInitialSchoolCode(allPrivilegesOnly, ["CD-IN-26-001", "BI-EC-26-001"])).toBe("CD-IN-26-001");
  });

  it("RESIDUEL : le bundle ALL_PRIVILEGES ouvre encore les vues scolaires Web", () => {
    const privCtx = ctx(allPrivilegesOnly);
    expect(canReadView(privCtx, "students")).toBe(true);
    expect(canReadView(privCtx, "messages")).toBe(true);
    expect(canReadView(privCtx, "payments")).toBe(true);
    expect(canReadView(privCtx, "dataExport")).toBe(false);
    expect(hasWebInternalNotificationScope(allPrivilegesOnly, "CD-IN-26-001")).toBe(true);
  });

  it("garde source P1-07 inchangée (deny par rôle)", () => {
    const deny = fs.readFileSync(path.join(ROOT, "src/lib/webSchoolDomainDeny.ts"), "utf8");
    expect(deny).toMatch(/export function shouldDenyWebSchoolDomain/);
    expect(deny).toMatch(/return isWebPlatformAdminUser\(user\)/);
  });
});
