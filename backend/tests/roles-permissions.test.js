const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { rolePermissions } = require("../data");
const { RbacService, routePermissions } = require("../services/rbacService");
const { RoleGovernanceService } = require("../services/roleGovernanceService");
const {
  canAccessBackOfficeRole,
  canAccessWebPlatformRole,
  isEstablishmentBackOfficeRole,
} = require("../lib/establishmentRoles");
const { canUserAccountLogin } = require("../lib/userAccountRules");

const ROLES = {
  SUPER_ADMIN: "Super Administrateur Somafrik",
  COUNTRY_ADMIN: "Admin Pays",
  SCHOOL_ADMIN: "Admin School",
  DIRECTEUR: "Directeur",
  PROVISEUR: "Proviseur",
  PREFET: "Préfet des études",
  ENSEIGNANT: "Enseignant",
  PARENT: "Parent",
  ELEVE: "Élève / Étudiant",
  COMPTABLE: "Comptable",
  SECRETAIRE: "Secrétaire",
};

const ALL_TARGET_ROLES = Object.values(ROLES);
const rbac = new RbacService(rolePermissions);
const governance = new RoleGovernanceService();

const COUNTRY_PRIVILEGE_MODULES = new Set([
  "Pays",
  "Établissements",
  "Abonnements",
  "Utilisateurs",
  "Rapports",
]);

function permissionsForRole(role) {
  return rbac.permissionsFor(role);
}

function principalForRole(role, overrides = {}) {
  return {
    role,
    permissions: overrides.permissions ?? permissionsForRole(role),
    status: overrides.status ?? "Actif",
    ...overrides,
  };
}

function modulePermissions(role, module) {
  return permissionsForRole(role).filter((permission) => permission.startsWith(`${module}:`));
}

function hasModuleAccess(role, module) {
  const permissions = permissionsForRole(role);
  if (permissions.includes("ALL_PRIVILEGES")) return true;
  if (permissions.includes("COUNTRY_PRIVILEGES") && COUNTRY_PRIVILEGE_MODULES.has(module)) {
    return true;
  }
  return modulePermissions(role, module).length > 0;
}

function hasGranularPermission(role, module, action) {
  const permissions = new Set(permissionsForRole(role));
  if (permissions.has("ALL_PRIVILEGES")) return true;
  if (permissions.has(`${module}:CRUD`)) return true;
  if (permissions.has(`${module}:${action}`)) return true;
  if (action === "READ" && permissions.has(`${module}:R`)) return true;
  return false;
}

function crudAccess(role, module) {
  const modPerms = new Set(modulePermissions(role, module));
  if (permissionsForRole(role).includes("ALL_PRIVILEGES")) {
    return { read: true, create: true, update: true, delete: true };
  }
  return {
    read: modPerms.has(`${module}:READ`) || modPerms.has(`${module}:CRUD`),
    create: modPerms.has(`${module}:CREATE`) || modPerms.has(`${module}:CRUD`),
    update: modPerms.has(`${module}:UPDATE`) || modPerms.has(`${module}:CRUD`),
    delete: modPerms.has(`${module}:DELETE`) || modPerms.has(`${module}:CRUD`),
  };
}

describe("Vérification des rôles", () => {
  for (const role of ALL_TARGET_ROLES) {
    it(`reconnaît le rôle existant : ${role}`, () => {
      const permissions = permissionsForRole(role);
      assert.ok(Array.isArray(permissions));
      assert.ok(permissions.length > 0, `Le rôle ${role} doit avoir des permissions`);
    });
  }

  it("rejette un rôle inexistant avec des droits minimaux", () => {
    assert.deepEqual(permissionsForRole("Rôle inexistant XYZ"), ["Voir tableau de bord"]);
  });

  it("identifie les rôles plateforme et établissement", () => {
    assert.equal(canAccessBackOfficeRole(ROLES.SUPER_ADMIN), true);
    assert.equal(canAccessBackOfficeRole(ROLES.COUNTRY_ADMIN), true);
    assert.equal(canAccessBackOfficeRole(ROLES.SCHOOL_ADMIN), true);
    assert.equal(canAccessBackOfficeRole(ROLES.SECRETAIRE), true);
    assert.equal(canAccessBackOfficeRole(ROLES.COMPTABLE), true);
    assert.equal(isEstablishmentBackOfficeRole(ROLES.COMPTABLE), true);
    assert.equal(isEstablishmentBackOfficeRole(ROLES.SUPER_ADMIN), false);
  });

  it("autorise les rôles web/mobile démo", () => {
    assert.equal(canAccessWebPlatformRole(ROLES.ENSEIGNANT), true);
    assert.equal(canAccessWebPlatformRole(ROLES.PARENT), true);
    assert.equal(canAccessWebPlatformRole(ROLES.ELEVE), true);
    assert.equal(canAccessWebPlatformRole("Rôle inexistant"), false);
  });

  it("reconnaît le super admin via RoleGovernanceService", () => {
    assert.equal(governance.isSuperAdminRole(ROLES.SUPER_ADMIN), true);
    assert.equal(governance.isSuperAdminRole(ROLES.ENSEIGNANT), false);
  });
});

describe("Vérification des permissions", () => {
  it("accorde une permission attendue à l'enseignant", () => {
    const principal = principalForRole(ROLES.ENSEIGNANT);
    assert.equal(rbac.canAccess(principal, "GET /api/v2/subjects"), true);
    assert.equal(hasGranularPermission(ROLES.ENSEIGNANT, "Notes", "CREATE"), true);
    assert.equal(hasGranularPermission(ROLES.ENSEIGNANT, "Notes", "UPDATE"), true);
  });

  it("refuse une permission interdite au parent", () => {
    const principal = principalForRole(ROLES.PARENT);
    assert.equal(rbac.canAccess(principal, "GET /api/users"), false);
    assert.equal(hasGranularPermission(ROLES.PARENT, "Utilisateurs", "READ"), false);
    assert.equal(hasGranularPermission(ROLES.PARENT, "Notes", "CREATE"), false);
  });

  it("refuse l'accès à un utilisateur sans rôle", () => {
    assert.equal(rbac.canAccess(null, "GET /api/users"), false);
    assert.equal(rbac.canAccess({ permissions: [] }, "GET /api/teachers"), false);
    assert.equal(rbac.canAccess(undefined, "GET /api/payments"), false);
  });

  it("bloque un compte avec rôle désactivé (statut inactif)", () => {
    const inactiveTeacher = {
      role: ROLES.ENSEIGNANT,
      status: "Inactif",
      permissions: permissionsForRole(ROLES.ENSEIGNANT),
    };
    assert.equal(canUserAccountLogin(inactiveTeacher), false);
    assert.equal(canUserAccountLogin({ role: ROLES.PARENT, status: "Suspendu" }), false);
    assert.equal(canUserAccountLogin({ role: ROLES.SECRETAIRE, status: "Actif" }), true);
  });

  it("accorde les privilèges pays à l'admin pays", () => {
    const principal = principalForRole(ROLES.COUNTRY_ADMIN);
    assert.equal(rbac.canAccess(principal, "GET /api/backoffice/establishments"), true);
    assert.equal(rbac.canAccess(principal, "POST /api/backoffice/establishments"), true);
    assert.equal(hasGranularPermission(ROLES.COUNTRY_ADMIN, "Établissements", "CREATE"), true);
  });

  it("accorde tous les privilèges au super admin", () => {
    const principal = principalForRole(ROLES.SUPER_ADMIN);
    assert.equal(rbac.canAccess(principal, "DELETE /api/backoffice/establishments/:code"), true);
    assert.equal(rbac.canAccess(principal, "GET /api/backoffice/countries"), true);
    assert.equal(hasGranularPermission(ROLES.SUPER_ADMIN, "Pays", "DELETE"), true);
  });
});

describe("Accès module par rôle", () => {
  const moduleChecks = [
    {
      role: ROLES.SUPER_ADMIN,
      allowed: ["Pays", "Établissements", "Élèves", "Paiements"],
      denied: [],
    },
    {
      role: ROLES.COUNTRY_ADMIN,
      allowed: ["Pays", "Établissements", "Utilisateurs"],
      denied: ["Notes", "Élèves"],
    },
    {
      role: ROLES.SCHOOL_ADMIN,
      allowed: ["Élèves", "Utilisateurs", "Notes"],
      denied: ["Pays", "Établissements"],
    },
    {
      role: ROLES.PREFET,
      allowed: ["Notes", "Élèves", "Paiements"],
      denied: ["Pays", "Établissements"],
    },
    {
      role: ROLES.DIRECTEUR,
      allowed: ["Notes", "Élèves", "Bulletins"],
      denied: ["Pays", "Établissements"],
    },
    {
      role: ROLES.PROVISEUR,
      allowed: ["Notes", "Bulletins", "Présences"],
      denied: ["Pays", "Établissements"],
    },
    {
      role: ROLES.ENSEIGNANT,
      allowed: ["Notes", "Élèves"],
      denied: ["Utilisateurs", "Pays"],
    },
    {
      role: ROLES.PARENT,
      allowed: ["Notes", "Élèves", "Paiements"],
      denied: ["Utilisateurs", "Enseignants"],
    },
    {
      role: ROLES.ELEVE,
      allowed: ["Notes", "Élèves", "Paiements"],
      denied: ["Utilisateurs"],
    },
    {
      role: ROLES.SECRETAIRE,
      allowed: ["Élèves", "Paiements", "Contacts"],
      denied: ["Pays", "Notes"],
    },
  ];

  for (const { role, allowed, denied } of moduleChecks) {
    it(`autorise les modules attendus pour ${role}`, () => {
      for (const module of allowed) {
        assert.equal(
          hasModuleAccess(role, module),
          true,
          `${role} devrait accéder au module ${module}`,
        );
      }
    });

    it(`refuse les modules interdits pour ${role}`, () => {
      for (const module of denied) {
        assert.equal(
          hasModuleAccess(role, module),
          false,
          `${role} ne devrait pas accéder au module ${module}`,
        );
      }
    });
  }

  it("limite les modules Admin Pays au périmètre pays", () => {
    const modules = governance.matrixModulesForRole(ROLES.COUNTRY_ADMIN);
    assert.ok(modules.includes("Pays"));
    assert.ok(modules.includes("Établissements"));
    assert.ok(!modules.includes("Notes"));
  });

  it("limite les modules Admin School au périmètre établissement", () => {
    const modules = governance.matrixModulesForRole(ROLES.SCHOOL_ADMIN);
    assert.ok(modules.includes("Élèves"));
    assert.ok(!modules.includes("Pays"));
    assert.ok(!modules.includes("Établissements"));
  });

  it("Comptable accède aux paiements via permissions legacy (pas de tokens CRUD)", () => {
    assert.equal(hasModuleAccess(ROLES.COMPTABLE, "Paiements"), false);
    const principal = principalForRole(ROLES.COMPTABLE);
    assert.equal(rbac.canAccess(principal, "GET /api/payments"), true);
    assert.equal(rbac.canAccess(principal, "GET /api/users"), false);
  });
});

describe("Accès action CRUD par rôle", () => {
  const crudScenarios = [
    {
      role: ROLES.SUPER_ADMIN,
      module: "Pays",
      expected: { read: true, create: true, update: true, delete: true },
    },
    {
      role: ROLES.COUNTRY_ADMIN,
      module: "Pays",
      expected: { read: true, create: false, update: false, delete: false },
    },
    {
      role: ROLES.COUNTRY_ADMIN,
      module: "Établissements",
      expected: { read: true, create: true, update: true, delete: true },
    },
    {
      role: ROLES.SCHOOL_ADMIN,
      module: "Élèves",
      expected: { read: true, create: true, update: true, delete: true },
    },
    {
      role: ROLES.SCHOOL_ADMIN,
      module: "Enseignants",
      expected: { read: true, create: true, update: false, delete: false },
    },
    {
      role: ROLES.PREFET,
      module: "Notes",
      expected: { read: true, create: true, update: true, delete: true },
    },
    {
      role: ROLES.ENSEIGNANT,
      module: "Notes",
      expected: { read: true, create: true, update: true, delete: true },
    },
    {
      role: ROLES.ENSEIGNANT,
      module: "Utilisateurs",
      expected: { read: false, create: false, update: false, delete: false },
    },
    {
      role: ROLES.PARENT,
      module: "Notes",
      expected: { read: true, create: false, update: false, delete: false },
    },
    {
      role: ROLES.PARENT,
      module: "Élèves",
      expected: { read: true, create: false, update: false, delete: false },
    },
    {
      role: ROLES.ELEVE,
      module: "Notes",
      expected: { read: true, create: false, update: false, delete: false },
    },
    {
      role: ROLES.SECRETAIRE,
      module: "Élèves",
      expected: { read: true, create: true, update: true, delete: true },
    },
    {
      role: ROLES.SECRETAIRE,
      module: "Notes",
      expected: { read: false, create: false, update: false, delete: false },
    },
    {
      role: ROLES.DIRECTEUR,
      module: "Notes",
      expected: { read: true, create: true, update: true, delete: true },
    },
    {
      role: ROLES.PROVISEUR,
      module: "Bulletins",
      expected: { read: true, create: true, update: true, delete: true },
    },
  ];

  for (const { role, module, expected } of crudScenarios) {
    it(`${role} — CRUD sur ${module}`, () => {
      const access = crudAccess(role, module);
      assert.equal(access.read, expected.read, `READ ${role}/${module}`);
      assert.equal(access.create, expected.create, `CREATE ${role}/${module}`);
      assert.equal(access.update, expected.update, `UPDATE ${role}/${module}`);
      assert.equal(access.delete, expected.delete, `DELETE ${role}/${module}`);
    });
  }

  it("Admin School peut lire mais pas modifier les enseignants (règle pédagogie)", () => {
    const principal = principalForRole(ROLES.SCHOOL_ADMIN);
    assert.equal(rbac.canAccess(principal, "GET /api/teachers"), true);
    assert.equal(hasGranularPermission(ROLES.SCHOOL_ADMIN, "Enseignants", "UPDATE"), false);
    assert.equal(hasGranularPermission(ROLES.SCHOOL_ADMIN, "Enseignants", "DELETE"), false);
  });

  it("Directeur et Proviseur héritent des droits Préfet via la matrice de sécurité", () => {
    assert.deepEqual(
      permissionsForRole(ROLES.DIRECTEUR).filter((p) => p.startsWith("Notes:")).sort(),
      permissionsForRole(ROLES.PREFET).filter((p) => p.startsWith("Notes:")).sort(),
    );
    assert.deepEqual(
      permissionsForRole(ROLES.PROVISEUR).filter((p) => p.startsWith("Présences:")).sort(),
      permissionsForRole(ROLES.PREFET).filter((p) => p.startsWith("Présences:")).sort(),
    );
  });
});

describe("Routes API protégées par RBAC", () => {
  it("refuse l'accès sans permission sur une route protégée", () => {
    const principal = principalForRole(ROLES.PARENT);
    const protectedRoutes = Object.keys(routePermissions);
    const denied = protectedRoutes.filter((route) => !rbac.canAccess(principal, route));
    assert.ok(denied.length > 0);
    assert.ok(denied.includes("GET /api/users"));
  });

  it("autorise le super admin sur les routes backoffice sensibles", () => {
    const principal = principalForRole(ROLES.SUPER_ADMIN);
    assert.equal(rbac.canAccess(principal, "GET /api/backoffice/countries"), true);
    assert.equal(rbac.canAccess(principal, "DELETE /api/backoffice/establishments/:code"), true);
  });

  it("autorise l'enseignant uniquement sur ses routes métier", () => {
    const principal = principalForRole(ROLES.ENSEIGNANT);
    assert.equal(rbac.canAccess(principal, "GET /api/v2/subjects"), true);
    assert.equal(rbac.canAccess(principal, "GET /api/v2/exams"), true);
    assert.equal(rbac.canAccess(principal, "POST /api/v2/subjects"), false);
    assert.equal(rbac.canAccess(principal, "GET /api/backoffice/establishments"), false);
    assert.equal(rbac.canAccess(principal, "GET /api/users"), false);
  });
});

describe("Normalisation des permissions gérées par le super admin", () => {
  it("conserve les permissions CRUD valides pour Admin Pays", () => {
    const normalized = governance.normalizeManagedRolePermissions(ROLES.COUNTRY_ADMIN, [
      "Établissements:READ",
      "Établissements:CREATE",
      "Pays:CREATE",
      "Pays:DELETE",
      "COUNTRY_PRIVILEGES",
    ]);
    assert.ok(normalized.includes("Établissements:READ"));
    assert.ok(normalized.includes("COUNTRY_PRIVILEGES"));
    assert.ok(!normalized.includes("Pays:CREATE"));
    assert.ok(!normalized.includes("Pays:DELETE"));
  });

  it("rejette les permissions hors périmètre établissement pour Admin School", () => {
    assert.equal(governance.isSchoolRolePermissionAllowed("Établissements:READ"), false);
    assert.equal(governance.isSchoolRolePermissionAllowed("Élèves:READ"), true);
  });
});
