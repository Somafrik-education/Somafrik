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

describe("domainsForPath — /planning ne dépend pas de Matières:READ", () => {
  it("Préfet Planning:CRUD sans Matières charge courseSchedules, pas courses", () => {
    const ctx: PermissionContext = {
      user: {
        role: "Préfet des études",
        schoolCode: "CD-2026-0001",
        permissions: [
          "Planning de cours:READ",
          "Planning de cours:CREATE",
          "Planning de cours:UPDATE",
          "Planning de cours:DELETE",
          "Classes:READ",
          "Enseignants:READ",
        ],
      },
      rolePermissions: {},
    };
    const domains = domainsForPath("/planning", ctx);
    expect(domains).toContain("courseSchedules");
    expect(domains).toContain("classes");
    expect(domains).not.toContain("courses");
  });
});

describe("domainsForPath — /notes n'hydrate pas les domaines globaux d'affectation", () => {
  it("charge notes + evaluations, sans assignments ni courses", () => {
    const domains = domainsForPath("/notes", teacherNotesContext);
    expect(domains).toContain("notes");
    expect(domains).toContain("evaluations");
    expect(domains).not.toContain("assignments");
    expect(domains).not.toContain("courses");
  });
});

describe("domainsForPath — tableau de bord hydrate l'assiette de paiement", () => {
  it("charge studentFees et presences pour un Admin établissement avec Paiements:READ", () => {
    const ctx: PermissionContext = {
      user: {
        role: "Admin School",
        schoolCode: "CD-IN-26-001",
        permissions: [
          "Paiements:READ",
          "Élèves:READ",
          "Présences:READ",
          "Utilisateurs:READ",
          "Classes:READ",
          "Enseignants:READ",
        ],
      },
      rolePermissions: {},
    };
    const domains = domainsForPath("/tableau-de-bord", ctx);
    expect(domains).toContain("studentFees");
    expect(domains).toContain("presences");
    expect(domains).toContain("payments");
  });
});
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
