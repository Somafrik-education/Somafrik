import { describe, expect, it } from "vitest";
import type { PermissionContext } from "./permissions";
import { domainsForPath } from "./routeDomainMap";

function ctx(role: string, permissions: string[]): PermissionContext {
  return {
    user: {
      id: "user-1",
      role,
      schoolCode: "CD-IN-26-001",
      permissions,
    },
    rolePermissions: {},
    permissionsReady: true,
  };
}

describe("routeDomainMap — Bulletins Parent", () => {
  it("ne précharge jamais le domaine générique bulletins pour un Parent", () => {
    const parent = ctx("parent_student", ["Bulletins:READ", "Élèves:READ"]);
    expect(domainsForPath("/bulletins", parent)).not.toContain("bulletins");
    expect(domainsForPath("/bulletins/historique", parent)).not.toContain("bulletins");
    expect(domainsForPath("/bulletins/modele", parent)).not.toContain("bulletins");
  });

  it("conserve le chargement bulletin générique pour le staff", () => {
    const staff = ctx("Admin School", ["Bulletins:READ"]);
    expect(domainsForPath("/bulletins", staff)).toContain("bulletins");
  });
});
