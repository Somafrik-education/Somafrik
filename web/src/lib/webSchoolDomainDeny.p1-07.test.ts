import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "../types";
import { pickInitialSchoolCode, withSchoolScope } from "./activeSchool";
import { canLoadDomain } from "./domainPermissions";
import { canReadView, hasBackOfficePermission, type PermissionContext } from "./permissions";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import { projectScopedStudents } from "./studentsScope";
import { isSuperAdminAllowedView } from "./superAdminAccess";
import { hasCommunicationSchoolScope } from "./communicationSchoolScope";
import {
  hasWebInternalNotificationScope,
  resolveWebNotificationsHref,
  shouldDenyWebSchoolDomain,
} from "./webSchoolDomainDeny";

const ROOT = dirname(fileURLToPath(import.meta.url));
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
    permissions: ["Élèves:READ", "Messages:READ", "Announcements:READ", "Notifications:READ"],
    schoolCode: "CD-2026-0001",
    schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    schoolPublicCode: "CD-IN-26-001",
    ...overrides,
  } as SessionUser;
}

describe("P1-07 Web — isolation stricte du domaine scolaire", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("deny par rôle uniquement : ALL_PRIVILEGES et schoolCode * n'ouvrent rien", () => {
    expect(shouldDenyWebSchoolDomain(superadmin())).toBe(true);
    expect(shouldDenyWebSchoolDomain(superadmin({ permissions: [] }))).toBe(true);
    expect(shouldDenyWebSchoolDomain(countryAdmin())).toBe(true);
    expect(
      shouldDenyWebSchoolDomain(
        schoolAdmin({ permissions: ["ALL_PRIVILEGES"], schoolCode: "*" }),
      ),
    ).toBe(false);
    expect(
      shouldDenyWebSchoolDomain({
        role: "Enseignant",
        permissions: ["ALL_PRIVILEGES"],
        schoolCode: "*",
      } as SessionUser),
    ).toBe(false);
    expect(shouldDenyWebSchoolDomain(null)).toBe(false);
  });

  it("pickInitialSchoolCode : pas d'auto-sélection ni de restauration pour Superadmin / Admin Pays", () => {
    sessionStorage.setItem(STORAGE_KEY, "CD-2026-0001");
    const available = ["CD-2026-0001", "BI-2026-0002"];
    expect(pickInitialSchoolCode(superadmin(), available)).toBe("");
    expect(pickInitialSchoolCode(countryAdmin(), available)).toBe("");
    expect(pickInitialSchoolCode(schoolAdmin(), available)).toBe("CD-2026-0001");
  });

  it("withSchoolScope ne tamponne pas un schoolCode sur un principal plateforme", () => {
    const stampedSuper = withSchoolScope(superadmin(), "CD-2026-0001");
    const stampedPays = withSchoolScope(countryAdmin(), "CD-2026-0001");
    expect(stampedSuper?.schoolCode).toBe("*");
    expect(stampedSuper?.role).toBe(SUPER_ADMIN_ROLE);
    expect(stampedPays?.schoolCode).toBe("*");
    expect(stampedPays?.role).toBe(COUNTRY_ADMIN_ROLE);
    expect(withSchoolScope(schoolAdmin(), "BI-2026-0002")?.schoolCode).toBe("CD-2026-0001");
  });

  it("projectScopedStudents : Superadmin / Admin Pays vides, Admin School conservé", () => {
    const rows = [
      {
        id: "el-1",
        schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        schoolCode: "CD-IN-26-001",
        firstName: "Amina",
      },
    ];
    const state = { students: rows };
    expect(projectScopedStudents(superadmin(), state).students).toEqual([]);
    expect(projectScopedStudents(superadmin(), state).kept).toBe(0);
    expect(projectScopedStudents(countryAdmin(), state).students).toEqual([]);
    expect(projectScopedStudents(schoolAdmin(), state).students).toHaveLength(1);
  });

  it("C4 : établissement actif ne bascule jamais Superadmin / Admin Pays vers /notifications", () => {
    expect(hasWebInternalNotificationScope(superadmin(), "CD-2026-0001")).toBe(false);
    expect(hasWebInternalNotificationScope(countryAdmin(), "CD-2026-0001")).toBe(false);
    expect(hasWebInternalNotificationScope(schoolAdmin(), "CD-2026-0001")).toBe(true);
    expect(resolveWebNotificationsHref(superadmin())).toBe("/notifications-plateforme");
    expect(resolveWebNotificationsHref(countryAdmin())).toBe("/notifications-plateforme");
    expect(resolveWebNotificationsHref(schoolAdmin())).toBe("/notifications");
    expect(hasCommunicationSchoolScope("CD-2026-0001", superadmin())).toBe(false);
    expect(hasCommunicationSchoolScope("CD-2026-0001", countryAdmin())).toBe(false);
    expect(hasCommunicationSchoolScope("CD-2026-0001", schoolAdmin())).toBe(true);
  });

  it("Export : vue dataExport fermée pour la plateforme, ouverte Admin School + Paramètres", () => {
    const superCtx = ctx(superadmin());
    const paysCtx = ctx(countryAdmin());
    const schoolCtx = ctx(schoolAdmin({ permissions: ["Paramètres Établissement:READ"] }));
    expect(canReadView(superCtx, "dataExport")).toBe(false);
    expect(canReadView(paysCtx, "dataExport")).toBe(false);
    expect(canReadView(schoolCtx, "dataExport")).toBe(true);
    expect(isSuperAdminAllowedView("dataExport")).toBe(false);
  });

  it("non-régression : Superadmin garde notifications / annonces plateforme, pas Messages", () => {
    const superCtx = ctx(superadmin());
    expect(canReadView(superCtx, "notifications")).toBe(true);
    expect(canReadView(superCtx, "announcements")).toBe(true);
    expect(canReadView(superCtx, "overview")).toBe(true);
    expect(canReadView(superCtx, "schools")).toBe(true);
    expect(canReadView(superCtx, "messages")).toBe(false);
    expect(hasBackOfficePermission(superCtx, "Messages", "READ")).toBe(false);
    expect(canLoadDomain(superCtx, "messages")).toBe(false);
  });

  it("non-régression : Admin Pays garde le périmètre pays, Admin School son établissement", () => {
    const pays = ctx(countryAdmin());
    const school = ctx(schoolAdmin());
    expect(canReadView(pays, "overview")).toBe(true);
    expect(canReadView(pays, "notifications")).toBe(true);
    expect(canReadView(pays, "announcements")).toBe(true);
    expect(canReadView(pays, "messages")).toBe(false);
    expect(canReadView(pays, "students")).toBe(false);
    expect(canReadView(school, "messages")).toBe(true);
    expect(canReadView(school, "announcements")).toBe(true);
    expect(canReadView(school, "notifications")).toBe(true);
    expect(
      canReadView(
        ctx(schoolAdmin({ permissions: ["Paramètres Établissement:READ"] })),
        "dataExport",
      ),
    ).toBe(true);
  });

  it("garde source : les quatre écarts #845 sont fermés côté Web uniquement", () => {
    const deny = readFileSync(join(ROOT, "webSchoolDomainDeny.ts"), "utf8");
    const active = readFileSync(join(ROOT, "activeSchool.ts"), "utf8");
    const students = readFileSync(join(ROOT, "studentsScope.ts"), "utf8");
    const permissions = readFileSync(join(ROOT, "permissions.ts"), "utf8");
    const topbar = readFileSync(join(ROOT, "../components/layout/Topbar.tsx"), "utf8");
    const overview = readFileSync(join(ROOT, "../pages/OverviewPage.tsx"), "utf8");
    const notifications = readFileSync(join(ROOT, "../pages/NotificationsPage.tsx"), "utf8");
    const announcements = readFileSync(join(ROOT, "../pages/AnnouncementsPage.tsx"), "utf8");
    const hub = readFileSync(join(ROOT, "../pages/parametres/SettingsHubPage.tsx"), "utf8");
    const exportPage = readFileSync(join(ROOT, "../pages/parametres/DataBackupSettingsPage.tsx"), "utf8");
    const app = readFileSync(join(ROOT, "../App.tsx"), "utf8");

    expect(deny).toMatch(/isSuperAdminRole/);
    expect(deny).toMatch(/COUNTRY_ADMIN_ROLE/);
    const denyFn = deny.slice(deny.indexOf("export function shouldDenyWebSchoolDomain"));
    const schoolBoundAt = denyFn.indexOf("hasWebSchoolBoundRole");
    const privilegesAt = denyFn.indexOf("hasAllPrivilegesToken");
    expect(schoolBoundAt).toBeGreaterThan(-1);
    expect(privilegesAt).toBeGreaterThan(schoolBoundAt);

    expect(active).toMatch(/shouldDenyWebSchoolDomain\(user\)/);
    expect(active).toMatch(/return "";/);
    expect(students).toMatch(/shouldDenyWebSchoolDomain\(user\)/);
    expect(students).toMatch(/emptyProjection\(user, received, null\)/);
    expect(students).not.toMatch(/withStudents\(user, received, received, null\)/);

    expect(permissions).toMatch(/viewName === "dataExport"/);
    expect(permissions).toMatch(/shouldDenyWebSchoolDomain\(ctx\.user\)/);
    expect(permissions).toMatch(/Paramètres Établissement:READ/);
    expect(permissions).toMatch(/Paramètres Établissement:UPDATE/);

    expect(topbar).toMatch(/hasWebInternalNotificationScope\(user, activeSchoolCode\)/);
    expect(topbar).toMatch(/resolveWebNotificationsHref\(user\)/);
    expect(overview).toMatch(/hasWebInternalNotificationScope\(user, activeSchoolCode\)/);
    expect(notifications).toMatch(/Navigate to="\/notifications-plateforme"/);
    expect(announcements).toMatch(/hasCommunicationSchoolScope\(activeSchoolCode, session\?\.user\)/);
    expect(announcements).toMatch(/denySchoolDomain/);

    expect(hub).not.toMatch(/SUPERADMIN_SETTING_PATHS[\s\S]*\/parametres\/donnees/);
    expect(hub).not.toMatch(/COUNTRY_ADMIN_SETTING_PATHS[\s\S]*\/parametres\/donnees/);
    expect(exportPage).toMatch(/shouldDenyWebSchoolDomain/);
    expect(exportPage).toMatch(/if \(denied\) return;/);
    expect(app).toMatch(/path="donnees"[\s\S]{0,180}?PermissionRoute view="dataExport"/);
  });
});
