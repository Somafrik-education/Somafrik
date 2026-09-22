import { describe, expect, it } from "vitest";
import type { SessionUser } from "../types";
import { isParentRole } from "./format";
import { canReadView, type PermissionContext } from "./permissions";

function parentCtx(): PermissionContext {
  return {
    user: {
      id: "parent-a",
      role: "Parent",
      roleKeys: ["PARENT"],
      permissions: [
        "Élèves:READ",
        "Notes:READ",
        "Bulletins:READ",
        "Présences:READ",
        "Paiements:READ",
        "Messages:READ",
        "Notifications:READ",
        "Announcements:READ",
        "Documents:READ",
      ],
    } as SessionUser,
    rolePermissions: {},
    permissionsReady: true,
  };
}

describe("shell Parent Web", () => {
  it("reconnaît les rôles Parent canoniques", () => {
    expect(isParentRole("Parent")).toBe(true);
    expect(isParentRole("parent_student")).toBe(true);
    expect(isParentRole("Enseignant")).toBe(false);
  });

  it("autorise uniquement les vues du shell Parent", () => {
    const ctx = parentCtx();
    for (const view of [
      "overview",
      "parentProfile",
      "notes",
      "presences",
      "bulletins",
      "payments",
      "messages",
      "announcements",
      "notifications",
      "documents",
    ]) {
      expect(canReadView(ctx, view), view).toBe(true);
    }

    for (const view of [
      "students",
      "establishment",
      "planning",
      "exams",
      "fees",
      "unpaid",
      "users",
      "permissions",
      "settings",
      "configuration",
      "teachers",
      "classes",
    ]) {
      expect(canReadView(ctx, view), view).toBe(false);
    }
  });

  it("reste fail-closed si une permission staff est accidentellement ajoutée", () => {
    const ctx = parentCtx();
    ctx.user = {
      ...ctx.user!,
      permissions: [...(ctx.user?.permissions ?? []), "Utilisateurs:READ", "Classes:READ", "Frais & tarifs:READ"],
    } as SessionUser;
    expect(canReadView(ctx, "users")).toBe(false);
    expect(canReadView(ctx, "classes")).toBe(false);
    expect(canReadView(ctx, "fees")).toBe(false);
  });
});
