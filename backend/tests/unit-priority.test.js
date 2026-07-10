const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  generateSchoolCode,
  validateSchoolPayload,
  findPotentialDuplicates,
  filterActiveSchools,
} = require("../lib/schoolModule");
const {
  validatePasswordPolicy,
  validatePinPolicy,
  findDuplicateLoginIdentifier,
  canUserAccountLogin,
} = require("../lib/userAccountRules");
const { hashSecret, verifySecret } = require("../services/credentialService");
const { TenantScopeService } = require("../services/tenantScopeService");
const { BusinessError } = require("../services/authService");

const tenantScope = new TenantScopeService();

function validSchool(overrides = {}) {
  return {
    name: "École Test",
    type: "Collège",
    country: "RDC",
    city: "Kinshasa",
    phone: "+243820000000",
    email: "contact@ecole.test",
    principalName: "Directeur Test",
    code: "CD-2026-0001",
    ...overrides,
  };
}

describe("Établissements — schoolModule", () => {
  it("génère un code établissement au format CODEPAYS-AAAA-0001", () => {
    assert.equal(generateSchoolCode("CD", []), `CD-${new Date().getFullYear()}-0001`);
    assert.equal(
      generateSchoolCode("CD", [{ code: `CD-${new Date().getFullYear()}-0003` }]),
      `CD-${new Date().getFullYear()}-0004`,
    );
  });

  it("rejette un établissement sans nom", () => {
    assert.match(validateSchoolPayload({ ...validSchool(), name: "A" }, []), /nom/i);
  });

  it("rejette un email invalide", () => {
    assert.match(validateSchoolPayload({ ...validSchool(), email: "invalide" }, []), /email/i);
  });

  it("rejette un code établissement déjà existant", () => {
    const schools = [{ code: "CD-2026-0001" }];
    assert.match(
      validateSchoolPayload(validSchool(), schools, { isNew: true }),
      /existe déjà/i,
    );
  });

  it("détecte les doublons potentiels par email", () => {
    const schools = [{ code: "CD-2026-0002", email: "contact@ecole.test" }];
    assert.equal(findPotentialDuplicates(validSchool(), schools).length, 1);
  });

  it("filtre les établissements supprimés", () => {
    const schools = [
      { code: "A", status: "Actif" },
      { code: "B", status: "Supprimé", deletedAt: "2026-01-01" },
    ];
    assert.equal(filterActiveSchools(schools).length, 1);
  });
});

describe("Utilisateurs — validateurs", () => {
  it("accepte un mot de passe valide", () => {
    assert.equal(validatePasswordPolicy("Secret123"), null);
  });

  it("rejette un mot de passe faible", () => {
    assert.match(validatePasswordPolicy("123"), /8 caractères/i);
    assert.match(validatePasswordPolicy("password"), /chiffre/i);
  });

  it("accepte un PIN de 6 chiffres", () => {
    assert.equal(validatePinPolicy("123456"), null);
  });

  it("rejette un PIN invalide", () => {
    assert.match(validatePinPolicy("12345"), /6 chiffres/i);
    assert.match(validatePinPolicy("12AB56"), /6 chiffres/i);
    assert.match(validatePinPolicy(""), /6 chiffres/i);
  });

  it("détecte un email/identifiant déjà utilisé", () => {
    const users = [
      { id: "1", identifier: "prof@ecole.app", email: "prof@ecole.app", schoolCode: "SCH1", status: "Actif" },
    ];
    const duplicate = findDuplicateLoginIdentifier(users, {
      identifier: "prof@ecole.app",
      schoolCode: "SCH1",
    });
    assert.ok(duplicate);
  });

  it("autorise uniquement les comptes actifs", () => {
    assert.equal(canUserAccountLogin({ status: "Actif" }), true);
    assert.equal(canUserAccountLogin({ status: "Inactif" }), false);
  });
});

describe("Sécurité — credentialService", () => {
  it("hash le mot de passe et ne stocke jamais en clair", () => {
    const hash = hashSecret("Secret123");
    assert.ok(hash.startsWith("scrypt$"));
    assert.notEqual(hash, "Secret123");
  });

  it("compare correctement un mot de passe hashé", () => {
    const hash = hashSecret("Secret123");
    assert.equal(verifySecret("Secret123", hash), true);
    assert.equal(verifySecret("Mauvais", hash), false);
  });
});

describe("Multi-établissement — tenantScopeService", () => {
  const rows = [
    { id: 1, schoolCode: "SCH-A", studentId: "STU-1", className: "6A" },
    { id: 2, schoolCode: "SCH-B", studentId: "STU-2", className: "6B" },
    { id: 3, schoolCode: "SCH-A", studentId: "STU-3", className: "6A" },
  ];

  it("filtre les données par établissement", () => {
    const principal = { role: "Admin School", schoolCode: "SCH-A" };
    const filtered = tenantScope.filterRows(rows, principal);
    assert.equal(filtered.length, 2);
    assert.ok(filtered.every((row) => row.schoolCode === "SCH-A"));
  });

  it("laisse le super admin voir tous les établissements", () => {
    const principal = { role: "Super Administrateur Somafrik", schoolCode: "*" };
    assert.equal(tenantScope.filterRows(rows, principal).length, 3);
  });

  it("refuse l'accès à un autre établissement", () => {
    const principal = { role: "Admin School", schoolCode: "SCH-A" };
    assert.throws(
      () => tenantScope.assertSchoolAccess(principal, "SCH-B"),
      (error) => error instanceof BusinessError && error.statusCode === 403,
    );
  });

  it("filtre les données parent sur ses enfants uniquement", () => {
    const principal = {
      role: "Parent",
      schoolCode: "SCH-A",
      studentIds: ["STU-1"],
    };
    const parentRows = [
      { studentId: "STU-1", entityType: "payment" },
      { studentId: "STU-2", entityType: "payment" },
    ];
    const filtered = tenantScope.filterRows(parentRows, principal);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].studentId, "STU-1");
  });
});
