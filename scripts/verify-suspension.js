/**
 * Vérifie la suspension Pays et Établissement déclenchée par le Super Administrateur.
 *
 * Ce script n'a pas besoin de base de données ni de serveur: il exerce
 * directement la logique métier (AuthService côté Web/Mobile et
 * BackOfficeAccessService côté BackOffice) avec un dataset qui reflète l'état
 * APRÈS application de la suspension (cf. applyStoredStatusOverlay dans server.js,
 * qui superpose le statut "Suspendu" du state BackOffice sur le dataset).
 *
 * Exécution: `node scripts/verify-suspension.js` ou `npm run check:suspension`.
 */

const { AuthService, BusinessError } = require("../backend/services/authService");
const { BackOfficeAccessService } = require("../backend/services/backOfficeAccessService");

let passed = 0;
let failed = 0;
const results = [];

function record(name, ok, detail) {
  results.push({ Scénario: name, Statut: ok ? "OK" : "ÉCHEC", Détail: detail });
  if (ok) passed += 1;
  else failed += 1;
}

/** Vérifie qu'une action lève une BusinessError 403 dont le message contient `fragment`. */
async function expectBlocked(name, fragment, action) {
  try {
    await action();
    record(name, false, "Aucune erreur levée alors qu'un blocage 403 était attendu");
  } catch (error) {
    const is403 = error instanceof BusinessError && error.statusCode === 403;
    const matches = String(error.message ?? "").toLowerCase().includes(fragment.toLowerCase());
    record(name, is403 && matches, `${error.statusCode ?? "?"} ${error.message}`);
  }
}

/** Vérifie qu'une action réussit (aucune erreur). */
async function expectAllowed(name, action) {
  try {
    const value = await action();
    record(name, true, summarize(value));
  } catch (error) {
    record(name, false, `${error.statusCode ?? "?"} ${error.message}`);
  }
}

function summarize(value) {
  if (value && value.user) return `connexion: ${value.user.role}`;
  if (value && value.code) return `école: ${value.code}`;
  return "OK";
}

function buildFixtures({ suspendedCountry = null, suspendedSchool = null } = {}) {
  const countryStatus = (code) => (code === suspendedCountry ? "Suspendu" : "Actif");
  const schoolStatus = (code) => (code === suspendedSchool ? "Suspendu" : "Actif");

  const countries = [
    { id: "C-CD", code: "CD", name: "RDC", status: countryStatus("CD") },
    { id: "C-SN", code: "SN", name: "Sénégal", status: countryStatus("SN") },
  ];

  const schools = [
    {
      id: "S-CD-1",
      code: "CD-2026-0001",
      name: "École Kinshasa",
      country: "RDC",
      countryCode: "CD",
      status: schoolStatus("CD-2026-0001"),
    },
    {
      id: "S-SN-1",
      code: "SN-2026-0001",
      name: "École Dakar",
      country: "Sénégal",
      countryCode: "SN",
      status: schoolStatus("SN-2026-0001"),
    },
  ];

  const userAccounts = [
    {
      id: "U-SUPER",
      identifier: "superadmin@somafrik.app",
      password: "1234",
      role: "Super Administrateur Somafrik",
      status: "Actif",
      accessChannel: "BackOffice",
      schoolCode: "*",
    },
    {
      id: "U-ADMIN-PAYS-CD",
      identifier: "adminpays.cd@somafrik.app",
      password: "1234",
      role: "Admin Pays",
      status: "Actif",
      accessChannel: "BackOffice",
      countryScope: "RDC",
      schoolCode: "*",
    },
    {
      id: "U-ADMIN-SCHOOL-CD",
      identifier: "admin.cd1@somafrik.app",
      password: "1234",
      role: "Admin School",
      status: "Actif",
      accessChannel: "BackOffice",
      countryScope: "RDC",
      schoolCode: "CD-2026-0001",
    },
  ];

  const authService = new AuthService({
    school: schools[0],
    schools,
    teachers: [],
    students: [],
    userAccounts,
    countries,
  });

  const backOffice = new BackOfficeAccessService({
    school: schools[0],
    schools,
    userAccounts,
    countries,
    subscriptions: [],
    notifications: [],
  });

  return { authService, backOffice };
}

async function main() {
  console.log("\n=== Vérification: suspension Pays & Établissement par le Super Admin ===\n");

  // --- Référence: rien n'est suspendu ---
  {
    const { authService, backOffice } = buildFixtures();
    await expectAllowed("Base | Connexion Web/Mobile école RDC active", () =>
      authService.assertSchoolCanConnect("CD-2026-0001")
    );
    await expectAllowed("Base | Connexion BackOffice Super Admin", () =>
      backOffice.login({ identifier: "superadmin@somafrik.app", password: "1234" })
    );
    await expectAllowed("Base | Connexion BackOffice Admin Pays RDC", () =>
      backOffice.login({ identifier: "adminpays.cd@somafrik.app", password: "1234" })
    );
    await expectAllowed("Base | Connexion BackOffice Admin École RDC", () =>
      backOffice.login({ identifier: "admin.cd1@somafrik.app", password: "1234", schoolCode: "CD-2026-0001" })
    );
  }

  // --- Scénario 1: le Super Admin suspend le PAYS RDC ---
  {
    const { authService, backOffice } = buildFixtures({ suspendedCountry: "CD" });
    await expectBlocked("Pays suspendu | Connexion Web/Mobile école RDC", "pays suspendu", () =>
      authService.assertSchoolCanConnect("CD-2026-0001")
    );
    await expectBlocked("Pays suspendu | Connexion BackOffice Admin Pays RDC", "pays suspendu", () =>
      backOffice.login({ identifier: "adminpays.cd@somafrik.app", password: "1234" })
    );
    await expectBlocked("Pays suspendu | Connexion BackOffice Admin École RDC", "pays suspendu", () =>
      backOffice.login({ identifier: "admin.cd1@somafrik.app", password: "1234", schoolCode: "CD-2026-0001" })
    );
    await expectAllowed("Pays suspendu | Super Admin garde l'accès (peut réactiver)", () =>
      backOffice.login({ identifier: "superadmin@somafrik.app", password: "1234" })
    );
    await expectAllowed("Pays suspendu | Autre pays (Sénégal) reste accessible", () =>
      authService.assertSchoolCanConnect("SN-2026-0001")
    );
  }

  // --- Scénario 2: le Super Admin suspend l'ÉTABLISSEMENT CD-2026-0001 ---
  {
    const { authService, backOffice } = buildFixtures({ suspendedSchool: "CD-2026-0001" });
    await expectBlocked("École suspendue | Connexion Web/Mobile", "etablissement suspendu", () =>
      authService.assertSchoolCanConnect("CD-2026-0001")
    );
    await expectBlocked("École suspendue | Connexion BackOffice ciblant l'école", "suspendu", () =>
      backOffice.login({ identifier: "admin.cd1@somafrik.app", password: "1234", schoolCode: "CD-2026-0001" })
    );
    await expectAllowed("École suspendue | Autre école du pays reste accessible", () =>
      authService.assertSchoolCanConnect("SN-2026-0001")
    );
    await expectAllowed("École suspendue | Super Admin garde l'accès (peut réactiver)", () =>
      backOffice.login({ identifier: "superadmin@somafrik.app", password: "1234" })
    );
  }

  console.table(results);
  console.log(`\nRésultat: ${passed} réussite(s), ${failed} échec(s).\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
