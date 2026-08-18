import { describe, expect, it } from "vitest";
import { SUPER_ADMIN_ROLE } from "./orgHierarchy";
import type { PermissionContext } from "./permissions";
import { domainsForPath } from "./routeDomainMap";

const superAdminContext: PermissionContext = {
  user: {
    role: SUPER_ADMIN_ROLE,
    schoolCode: "*",
    permissions: ["ALL_PRIVILEGES"],
  },
  rolePermissions: {},
};

const prefetContext: PermissionContext = {
  user: {
    role: "Préfet des études",
    schoolCode: "CD-2026-0001",
    permissions: ["Utilisateurs:READ", "Contacts:READ"],
  },
  rolePermissions: {},
};

const teacherNotesContext: PermissionContext = {
  user: {
    role: "Enseignant",
    schoolCode: "CD-2026-0001",
    permissions: ["Notes:READ", "Notes:CREATE"],
  },
  rolePermissions: {},
};

describe("domainsForPath — /notes n'hydrate pas les domaines globaux d'affectation", () => {
  it("ne charge ni assignments ni courses", () => {
    const domains = domainsForPath("/notes", teacherNotesContext);
    expect(domains).toContain("notes");
    expect(domains).not.toContain("assignments");
    expect(domains).not.toContain("courses");
  });
});

describe("domainsForPath — comptes utilisateurs", () => {
  it("charge schools avec users sur la route Superadmin pour le formulaire, pas pour le code public", () => {
    const domains = domainsForPath("/administration/utilisateurs", superAdminContext);

    expect(domains).toContain("users");
    expect(domains).toContain("schools");
  });

  it("ne charge pas le domaine schools pour un Préfet sur comptes utilisateurs", () => {
    const domains = domainsForPath("/etablissement/comptes-utilisateurs", prefetContext);

    expect(domains).toContain("users");
    expect(domains).not.toContain("schools");
  });
});
