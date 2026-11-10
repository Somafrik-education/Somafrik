/**
 * P1-10 — ALL_PRIVILEGES seul (sans rôle plateforme ni scolaire) ne devient pas Admin School Web.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "../types";
import { pickInitialSchoolCode, withSchoolScope } from "./activeSchool";
import { canLoadDomain } from "./domainPermissions";
import { canReadView, hasBackOfficePermission, type PermissionContext } from "./permissions";
import { SCHOOL_ADMIN_ROLE } from "./orgHierarchy";
import { projectScopedStudents } from "./studentsScope";
import { hasCommunicationSchoolScope } from "./communicationSchoolScope";
import {
  hasWebInternalNotificationScope,
  resolveWebNotificationsHref,
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

const agent = user({});
const emptyRole = user({ role: "" });
const wildcardOnly = user({ role: "Agent", permissions: [], schoolCode: "*" });
const schoolAdmin = user({
  role: SCHOOL_ADMIN_ROLE,
  permissions: ["Élèves:READ", "Messages:READ", "Paiements:READ", "ALL_PRIVILEGES"],
  schoolCode: "CD-2026-0001",
  schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
});
const teacher = user({
  role: "Enseignant",
  permissions: ["Élèves:READ", "ALL_PRIVILEGES"],
  schoolCode: "CD-2026-0001",
});
const parent = user({
  role: "Parent",
  permissions: ["Élèves:READ", "ALL_PRIVILEGES"],
  schoolCode: "CD-2026-0001",
});
const student = user({
  role: "Élève / Étudiant",
  permissions: ["Élèves:READ", "ALL_PRIVILEGES"],
  schoolCode: "CD-2026-0001",
});

describe("P1-10 Web — ALL_PRIVILEGES sans rôle plateforme", () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem("somafrik.activeSchoolCode", "CD-IN-26-001");
  });

  it("Agent + ALL_PRIVILEGES + * n'est pas un Admin School", () => {
    expect(shouldDenyWebSchoolDomain(agent)).toBe(true);
    expect(shouldDenyWebSchoolDomain(emptyRole)).toBe(true);
    expect(shouldDenyWebSchoolDomain(wildcardOnly)).toBe(true);
    expect(pickInitialSchoolCode(agent, ["CD-IN-26-001", "BI-EC-26-001"])).toBe("");
    expect(withSchoolScope(agent, "CD-IN-26-001")?.schoolCode).toBe("*");
    expect(hasWebInternalNotificationScope(agent, "CD-IN-26-001")).toBe(false);
    expect(hasCommunicationSchoolScope("CD-IN-26-001", agent)).toBe(false);
    expect(resolveWebNotificationsHref(agent)).toBe("/notifications-plateforme");
    const rows = [{ id: "stu-1", schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }];
    expect(projectScopedStudents(agent, { students: rows }).students).toEqual([]);
  });

  it("les vues scolaires sont fermées, les fonctions plateforme restent", () => {
    const agentCtx = ctx(agent);
    for (const view of ["students", "messages", "payments", "notes", "presences", "planning"] as const) {
      expect(canReadView(agentCtx, view)).toBe(false);
    }
    expect(hasBackOfficePermission(agentCtx, "Élèves", "READ")).toBe(false);
    expect(hasBackOfficePermission(agentCtx, "Messages", "READ")).toBe(false);
    expect(hasBackOfficePermission(agentCtx, "Paiements", "READ")).toBe(false);
    expect(canLoadDomain(agentCtx, "students")).toBe(false);
    expect(canLoadDomain(agentCtx, "messages")).toBe(false);
    expect(canReadView(agentCtx, "users")).toBe(true);
    expect(canReadView(agentCtx, "schools")).toBe(true);
    expect(canReadView(agentCtx, "overview")).toBe(true);
    expect(hasBackOfficePermission(agentCtx, "Utilisateurs", "READ")).toBe(true);
  });

  it("Admin School / Teacher / Parent / Student + ALL_PRIVILEGES ne régressent pas", () => {
    expect(shouldDenyWebSchoolDomain(schoolAdmin)).toBe(false);
    expect(shouldDenyWebSchoolDomain(teacher)).toBe(false);
    expect(shouldDenyWebSchoolDomain(parent)).toBe(false);
    expect(shouldDenyWebSchoolDomain(student)).toBe(false);
    expect(canReadView(ctx(schoolAdmin), "students")).toBe(true);
    expect(canReadView(ctx(schoolAdmin), "messages")).toBe(true);
    expect(canReadView(ctx(teacher), "students")).toBe(true);
    expect(canReadView(ctx(parent), "students")).toBe(true);
    expect(pickInitialSchoolCode(schoolAdmin, ["CD-IN-26-001"])).toBe("CD-2026-0001");
  });
});
