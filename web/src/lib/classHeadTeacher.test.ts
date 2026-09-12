import { describe, expect, it } from "vitest";
import {
  HEAD_TEACHER_COPY,
  classHasHeadTeacher,
  classHeadTeacherDisplayName,
  formatHeadTeacherDisplayName,
  formatHeadTeacherLine,
} from "./classHeadTeacher";
import { canAssignClassHeadTeacher } from "./permissions";
import { SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE, COUNTRY_ADMIN_ROLE } from "./orgHierarchy";
import type { SessionUser } from "../types";

describe("classHeadTeacher", () => {
  it("formate Prénom NOM", () => {
    expect(formatHeadTeacherDisplayName("Awa", "Diop")).toBe("Awa DIOP");
    expect(formatHeadTeacherLine("Awa DIOP")).toBe("Professeur principal : Awa DIOP");
    expect(formatHeadTeacherLine("")).toBe("Professeur principal : Non assigné");
  });

  it("détecte une affectation existante", () => {
    expect(classHasHeadTeacher({ teacherId: "SCH-A-ENS-0001" })).toBe(false);
    expect(classHasHeadTeacher({ headTeacherCode: "SCH-A-ENS-0001" })).toBe(true);
    expect(classHasHeadTeacher({})).toBe(false);
    expect(classHeadTeacherDisplayName({ headTeacherDisplayName: "Awa DIOP" })).toBe("Awa DIOP");
    expect(classHeadTeacherDisplayName({ teacher: "Non assigné" })).toBe("");
  });
});

describe("canAssignClassHeadTeacher", () => {
  const ctx = (user: Partial<SessionUser>) => ({
    user: { id: "u1", role: SCHOOL_ADMIN_ROLE, ...user } as SessionUser,
    rolePermissions: {},
  });

  it("autorise superadmin, admin établissement et droits explicites", () => {
    expect(canAssignClassHeadTeacher(ctx({ role: SUPER_ADMIN_ROLE }))).toBe(true);
    expect(canAssignClassHeadTeacher(ctx({ role: SCHOOL_ADMIN_ROLE }))).toBe(true);
    expect(
      canAssignClassHeadTeacher(
        ctx({ role: "Préfet des études", permissions: ["Affectations:CREATE"] }),
      ),
    ).toBe(true);
  });

  it("refuse un enseignant sans droit de gestion", () => {
    expect(
      canAssignClassHeadTeacher(
        ctx({ role: "Enseignant", permissions: ["Classes:READ", "Voir classes"] }),
      ),
    ).toBe(false);
    expect(canAssignClassHeadTeacher(ctx({ role: COUNTRY_ADMIN_ROLE, permissions: ["COUNTRY_PRIVILEGES"] }))).toBe(
      false,
    );
  });

  it("honore une révocation explicite sur Admin School", () => {
    expect(
      canAssignClassHeadTeacher(
        ctx({ role: SCHOOL_ADMIN_ROLE, permissions: ["Classes:READ", "Voir classes"] }),
      ),
    ).toBe(false);
    expect(
      canAssignClassHeadTeacher(
        ctx({ role: SCHOOL_ADMIN_ROLE, permissions: ["Classes:UPDATE", "Gérer classes"] }),
      ),
    ).toBe(true);
  });
});

describe("HEAD_TEACHER_COPY", () => {
  it("porte les libellés du mandat", () => {
    expect(HEAD_TEACHER_COPY.assign).toBe("Affecter un professeur principal");
    expect(HEAD_TEACHER_COPY.confirm).toMatch(/Confirmer l.affectation/);
    expect(HEAD_TEACHER_COPY.modify).toMatch(/Modifier l.affectation/);
  });
});
