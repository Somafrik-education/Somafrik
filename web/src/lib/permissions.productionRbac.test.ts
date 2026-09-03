import { describe, expect, it } from "vitest";
import type { SessionUser, UserAccount } from "../types";
import {
  canReadView,
  canResetTargetUserPassword,
  type PermissionContext,
} from "./permissions";

function ctx(user: Partial<SessionUser>, extra: Partial<PermissionContext> = {}): PermissionContext {
  return {
    user: user as SessionUser,
    rolePermissions: {},
    permissionsReady: true,
    ...extra,
  };
}

describe("P0 production RBAC web", () => {
  it("Enseignant production (alias + jetons) ouvre élèves, notes, messages, pas utilisateurs", () => {
    const teacher = ctx({
      role: "Enseignant",
      permissions: [
        "Voir élèves",
        "Élèves:READ",
        "Messages parents",
        "Messages:READ",
        "Voir notes",
        "Notes:READ",
        "Modifier notes",
        "Notes:UPDATE",
        "Faire appel",
        "Présences:READ",
        "Classes:READ",
      ],
    });

    expect(canReadView(teacher, "students")).toBe(true);
    expect(canReadView(teacher, "notes")).toBe(true);
    expect(canReadView(teacher, "messages")).toBe(true);
    expect(canReadView(teacher, "presences")).toBe(true);
    expect(canReadView(teacher, "users")).toBe(false);
  });

  it("affiche Réinitialiser uniquement pour un acteur Utilisateurs:UPDATE du même schoolId", () => {
    const schoolId = "11111111-1111-4111-8111-111111111111";
    const admin = ctx({
      role: "Admin School",
      schoolId,
      permissions: ["Utilisateurs:UPDATE", "Gérer utilisateurs"],
    });
    const teacher = ctx({
      role: "Enseignant",
      schoolId,
      permissions: ["Élèves:READ", "Messages:READ"],
    });
    const target = {
      role: "Enseignant",
      schoolId,
      schoolCode: "CD-ITS-26-001",
    } as UserAccount;
    const otherSchool = {
      role: "Enseignant",
      schoolId: "22222222-2222-4222-8222-222222222222",
      schoolCode: "CD-ITS-26-001",
    } as UserAccount;

    expect(canResetTargetUserPassword(admin, target)).toBe(true);
    expect(canResetTargetUserPassword(admin, otherSchool)).toBe(false);
    expect(canResetTargetUserPassword(teacher, target)).toBe(false);
  });

  it("Parent / Élève restent limités à leurs vues lecture", () => {
    const parent = ctx({
      role: "Parent",
      permissions: ["Voir enfant", "Élèves:READ", "Notes:READ", "Messages école", "Messages:READ"],
    });
    const student = ctx({
      role: "Élève / Étudiant",
      permissions: ["Voir notes", "Notes:READ", "Présences:READ"],
    });
    expect(canReadView(parent, "students")).toBe(true);
    expect(canReadView(parent, "users")).toBe(false);
    expect(canReadView(student, "notes")).toBe(true);
    expect(canReadView(student, "users")).toBe(false);
  });
});
