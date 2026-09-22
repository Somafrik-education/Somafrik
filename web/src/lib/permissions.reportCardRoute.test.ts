import { describe, expect, it } from "vitest";
import type { SessionUser } from "../types";
import { canAccessView, canReadView, type PermissionContext } from "./permissions";

function ctx(user: Partial<SessionUser>, extra: Partial<PermissionContext> = {}): PermissionContext {
  return {
    user: user as SessionUser,
    rolePermissions: {},
    permissionsReady: true,
    permissionsBootstrap: "ready",
    ...extra,
  };
}

describe("P1-A /bulletins/modele — canAccessView CREATE", () => {
  it("Secrétaire Bulletins:READ ouvre la liste mais pas la route métier CREATE", () => {
    const secretary = ctx({
      role: "Secrétaire",
      permissions: ["Bulletins:READ", "Élèves:READ"],
    });
    expect(canReadView(secretary, "bulletins")).toBe(true);
    expect(canAccessView(secretary, "bulletins", "READ")).toBe(true);
    expect(canAccessView(secretary, "bulletins", "CREATE")).toBe(false);
  });

  it("Admin School Bulletins:CREATE accède à la route modèle", () => {
    const admin = ctx({
      role: "Admin School",
      permissions: ["Bulletins:READ", "Bulletins:CREATE", "Bulletins:UPDATE"],
    });
    expect(canAccessView(admin, "bulletins", "READ")).toBe(true);
    expect(canAccessView(admin, "bulletins", "CREATE")).toBe(true);
  });

  it("UPDATE seul ne suffit pas pour la demande de modèle", () => {
    const reviewer = ctx({
      role: "Proviseur",
      permissions: ["Bulletins:READ", "Bulletins:UPDATE"],
    });
    expect(canAccessView(reviewer, "bulletins", "READ")).toBe(true);
    expect(canAccessView(reviewer, "bulletins", "CREATE")).toBe(false);
    expect(canAccessView(reviewer, "bulletins", "UPDATE")).toBe(true);
  });
});
