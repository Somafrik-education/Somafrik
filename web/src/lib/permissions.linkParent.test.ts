import { describe, expect, it } from "vitest";
import { canArchiveParentRelation, canLinkParent } from "./permissions";
import type { PermissionContext } from "./permissions";

function ctx(role: string, permissions?: string[]): PermissionContext {
  return {
    user: {
      id: "u1",
      role,
      schoolCode: "CD-2026-0001",
      permissions,
    } as never,
    rolePermissions: {},
  };
}

describe("canLinkParent — aligné POST /api/parents/link", () => {
  it("autorise Admin School avec Relations:CREATE", () => {
    expect(canLinkParent(ctx("Admin School", ["Relations:CREATE", "Relations:READ"]))).toBe(true);
  });

  it("autorise Directeur avec Gérer utilisateurs", () => {
    expect(canLinkParent(ctx("Directeur", ["Gérer utilisateurs", "Voir élèves"]))).toBe(true);
  });

  it("refuse Préfet, Secrétaire et Enseignant", () => {
    expect(canLinkParent(ctx("Préfet des études", ["Élèves:READ", "Relations:READ"]))).toBe(false);
    expect(canLinkParent(ctx("Secrétaire", ["Élèves:READ", "Relations:READ"]))).toBe(false);
    expect(canLinkParent(ctx("Enseignant", ["Élèves:READ", "Notes:UPDATE"]))).toBe(false);
    expect(canArchiveParentRelation(ctx("Enseignant", ["Élèves:READ"]))).toBe(false);
  });
});
