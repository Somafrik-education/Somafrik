/**
 * P1-13 — Replay final Web après #855.
 * Le résiduel P1-09 reste fermé, y compris Matières.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "../types";
import { pickInitialSchoolCode } from "./activeSchool";
import { canLoadDomain } from "./domainPermissions";
import { canReadView, hasBackOfficePermission, type PermissionContext } from "./permissions";
import { SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE, COUNTRY_ADMIN_ROLE } from "./orgHierarchy";
import { projectScopedStudents } from "./studentsScope";
import {
  hasWebInternalNotificationScope,
  shouldDenyWebSchoolDomain,
} from "./webSchoolDomainDeny";

function ctx(user: Partial<SessionUser>): PermissionContext {
  return { user: user as SessionUser, rolePermissions: {}, permissionsReady: true };
}

function user(overrides: Partial<SessionUser>): SessionUser {
  return {
    id: "u-1",
    firstName: "A",
    lastName: "B",
    identifier: "u-1",
    role: "Agent",
    permissions: ["ALL_PRIVILEGES"],
    schoolCode: "*",
    ...overrides,
  } as SessionUser;
}

describe("P1-13 Web — fermeture après #855", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("Superadmin / Admin Pays / Agent + ALL_PRIVILEGES : zéro vue scolaire", () => {
    const principals = [
      user({ role: SUPER_ADMIN_ROLE }),
      user({ role: COUNTRY_ADMIN_ROLE, permissions: ["COUNTRY_PRIVILEGES"] }),
      user({}),
      user({ role: "" }),
    ];
    for (const principal of principals) {
      const view = ctx(principal);
      expect(shouldDenyWebSchoolDomain(principal)).toBe(true);
      expect(pickInitialSchoolCode(principal, ["CD-IN-26-001"])).toBe("");
      expect(hasWebInternalNotificationScope(principal, "CD-IN-26-001")).toBe(false);
      expect(projectScopedStudents(principal, { students: [{ id: "stu-1", schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }] }).students).toEqual([]);
      for (const name of ["students", "messages", "payments", "notes", "presences", "planning"] as const) {
        expect(canReadView(view, name)).toBe(false);
      }
      expect(hasBackOfficePermission(view, "Matières", "READ")).toBe(false);
      expect(canLoadDomain(view, "students")).toBe(false);
    }
  });

  it("fonctions plateforme Agent conservées, Admin School inchangé", () => {
    const agent = ctx(user({}));
    expect(canReadView(agent, "users")).toBe(true);
    expect(hasBackOfficePermission(agent, "Utilisateurs", "READ")).toBe(true);
    const school = user({
      role: SCHOOL_ADMIN_ROLE,
      permissions: ["Élèves:READ", "Messages:READ", "ALL_PRIVILEGES"],
      schoolCode: "CD-2026-0001",
      schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(shouldDenyWebSchoolDomain(school)).toBe(false);
    expect(canReadView(ctx(school), "students")).toBe(true);
    expect(canReadView(ctx(school), "messages")).toBe(true);
    expect(hasBackOfficePermission(ctx(school), "Matières", "READ")).toBe(true);
  });
});
