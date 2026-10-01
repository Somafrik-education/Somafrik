/**
 * P1-05 — Audit de fermeture Superadmin (Web).
 * Aucune correction produit : invariants fermés + écarts restants documentés.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canReadView, hasBackOfficePermission, type PermissionContext } from "./permissions";
import { isSuperAdminAllowedView } from "./superAdminAccess";
import { canLoadDomain } from "./domainPermissions";
import { pickInitialSchoolCode } from "./activeSchool";
import { projectScopedStudents } from "./studentsScope";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import type { SessionUser } from "../types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function ctx(user: Partial<SessionUser>): PermissionContext {
  return {
    user: user as SessionUser,
    rolePermissions: {},
    permissionsReady: true,
  };
}

const superadmin = ctx({
  role: SUPER_ADMIN_ROLE,
  permissions: ["ALL_PRIVILEGES"],
  schoolCode: "*",
});
const country = ctx({
  role: COUNTRY_ADMIN_ROLE,
  permissions: ["COUNTRY_PRIVILEGES"],
  schoolCode: "*",
});
const school = ctx({
  role: SCHOOL_ADMIN_ROLE,
  permissions: ["Élèves:READ", "Messages:READ", "Paiements:READ"],
  schoolCode: "CD-2026-0001",
});

describe("P1-05 Web — replay fermetures P1-01 / P1-03", () => {
  it("Superadmin / Admin Pays : Messages scolaires fermés", () => {
    expect(isSuperAdminAllowedView("messages")).toBe(false);
    expect(canReadView(superadmin, "messages")).toBe(false);
    expect(hasBackOfficePermission(superadmin, "Messages", "READ")).toBe(false);
    expect(canLoadDomain(superadmin, "messages")).toBe(false);
    expect(canReadView(country, "messages")).toBe(false);
    expect(canLoadDomain(country, "messages")).toBe(false);
  });

  it("Superadmin : Finance scolaire / Élèves / Présences / Notes fermés", () => {
    expect(isSuperAdminAllowedView("payments")).toBe(false);
    expect(isSuperAdminAllowedView("students")).toBe(false);
    expect(canReadView(superadmin, "payments")).toBe(false);
    expect(canReadView(superadmin, "students")).toBe(false);
    expect(canLoadDomain(superadmin, "payments")).toBe(false);
    expect(canLoadDomain(superadmin, "students")).toBe(false);
  });

  it("Admin School conserve le scolaire", () => {
    expect(canReadView(school, "messages")).toBe(true);
    expect(canReadView(school, "students")).toBe(true);
  });
});

describe("P1-05 Web — écarts restants (KNOWN_GAP, pas de correctif ici)", () => {
  it("pickInitialSchoolCode auto-sélectionne le premier établissement", () => {
    expect(pickInitialSchoolCode({ role: SUPER_ADMIN_ROLE, schoolCode: "*" } as SessionUser, ["CD-IN-26-001", "BI-EC-26-001"])).toBe(
      "CD-IN-26-001",
    );
  });

  it("projectScopedStudents Superadmin / Admin Pays laisse passer les lignes reçues", () => {
    const rows = [{ id: "stu-1", schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }];
    expect(projectScopedStudents({ role: SUPER_ADMIN_ROLE, schoolCode: "*" } as SessionUser, { students: rows }).students).toHaveLength(1);
    expect(projectScopedStudents({ role: COUNTRY_ADMIN_ROLE, schoolCode: "*" } as SessionUser, { students: rows }).students).toHaveLength(1);
  });

  it("hub Paramètres expose encore l'export datasets scolaires", () => {
    const page = fs.readFileSync(path.join(ROOT, "src/pages/parametres/DataBackupSettingsPage.tsx"), "utf8");
    expect(page).toMatch(/key: "students"/);
    expect(page).toMatch(/\/data-export/);
  });

  it("Topbar bascule encore C4 dès qu'un établissement actif existe", () => {
    const topbar = fs.readFileSync(path.join(ROOT, "src/components/layout/Topbar.tsx"), "utf8");
    expect(topbar).toMatch(/hasInternalNotificationScope/);
    expect(topbar).toMatch(/\/notifications/);
  });
});
