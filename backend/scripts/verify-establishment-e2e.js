/**
 * TEST E2E — Parcours de création d'un établissement.
 *
 * Objectif : vérifier qu'un établissement peut être créé, configuré et rendu
 * exploitable, en s'appuyant sur la logique métier réelle (EstablishmentService
 * + AuthService) sur un état en mémoire, sans serveur ni base de données.
 *
 * Parcours couvert :
 *   1. Le superadmin crée un établissement (nom, pays, ville, type, code, logo,
 *      contact principal).
 *   2. Le système génère ou valide le code établissement.
 *   3. L'établissement apparaît dans la liste.
 *   4. Le superadmin active l'établissement.
 *   5. L'admin établissement peut se connecter avec le code établissement.
 *
 * Vérifications métier :
 *   - L'établissement est visible uniquement pour les utilisateurs autorisés.
 *   - Le code établissement est unique.
 *   - Un établissement inactif (en attente / suspendu) ne permet pas la
 *     connexion des utilisateurs liés.
 *
 * Exécution : node scripts/verify-establishment-e2e.js
 */
const assert = require("assert");

const { EstablishmentService } = require("../services/establishmentService");
const { AuthService, BusinessError } = require("../services/authService");

let passed = 0;
const failures = [];

async function check(label, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  \u2713 ${label}`);
  } catch (error) {
    failures.push({ label, message: error.message });
    console.error(`  \u2717 ${label}\n      ${error.message}`);
  }
}

/** Vérifie qu'un appel lève bien une BusinessError avec le code/message attendu. */
async function expectBusinessError(fn, { statusCode, messageIncludes } = {}) {
  let thrown = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, "Aucune erreur levée alors qu'une erreur était attendue.");
  if (statusCode != null) {
    assert.strictEqual(
      thrown.statusCode,
      statusCode,
      `Code attendu ${statusCode}, reçu ${thrown.statusCode} (${thrown.message})`,
    );
  }
  if (messageIncludes) {
    assert.ok(
      String(thrown.message).includes(messageIncludes),
      `Message attendu contenant « ${messageIncludes} », reçu « ${thrown.message} »`,
    );
  }
  return thrown;
}

function buildAuthService(state, schoolCode) {
  const school = (state.schools ?? []).find(
    (item) => String(item.code ?? "").trim().toUpperCase() === String(schoolCode).trim().toUpperCase(),
  );
  return new AuthService({
    school,
    schools: state.schools ?? [],
    teachers: state.teachers ?? [],
    students: state.students ?? [],
    userAccounts: state.users ?? [],
    countries: state.countries ?? [],
    subscriptions: state.subscriptions ?? [],
    assignments: state.assignments ?? [],
  });
}

async function main() {
  const service = new EstablishmentService();

  // ---------------------------------------------------------------------------
  // Acteurs (principals).
  // ---------------------------------------------------------------------------
  const superAdmin = {
    sub: "SA-1",
    identifier: "superadmin",
    role: "Super Administrateur Somafrik",
    permissions: ["ALL_PRIVILEGES"],
  };
  const countryAdminBI = {
    sub: "CA-BI",
    identifier: "admin-bi",
    role: "Admin Pays",
    countryScope: "BI",
    permissions: ["COUNTRY_PRIVILEGES"],
  };
  const foreignSchoolAdmin = {
    sub: "ADM-X",
    identifier: "admin-autre",
    role: "Admin School",
    schoolCode: "CD-2026-9999",
    permissions: ["Paramètres Établissement:READ"],
  };

  // ---------------------------------------------------------------------------
  // État initial : un pays actif, aucune école, aucun utilisateur.
  // ---------------------------------------------------------------------------
  let state = {
    countries: [{ name: "RDC", code: "CD", status: "Actif" }],
    schools: [],
    users: [],
    teachers: [],
    students: [],
    subscriptions: [],
    assignments: [],
    auditLog: [],
  };

  console.log("\n=== E2E — Création d'un établissement ===\n");

  // ---------------------------------------------------------------------------
  // Étape 1 & 2 — Le superadmin crée un établissement ; code généré.
  //   On le crée volontairement en état « En attente » (non activé) pour
  //   pouvoir vérifier plus loin que la connexion est bloquée tant qu'il n'est
  //   pas activé.
  // ---------------------------------------------------------------------------
  let created;
  await check("1. Le superadmin crée un établissement avec les infos obligatoires", () => {
    const result = service.create(
      {
        name: "Lycée Somafrik Test",
        country: "RDC",
        city: "Kinshasa",
        type: "Lycée",
        phone: "+243 990 000 111",
        email: "contact@lycee-test.cd",
        principalName: "Awa Kabila",
        principalEmail: "awa@lycee-test.cd",
        principalPhone: "+243 990 000 112",
        logoUrl: "https://cdn.somafrik.test/logo.png",
        status: "En attente",
        validationStatus: "En attente de validation",
      },
      state,
      superAdmin,
    );
    created = result.school;
    state = result.state;
    assert.ok(created, "Établissement non créé.");
  });

  await check("2. Le système génère un code établissement unique et bien formé", () => {
    assert.match(
      String(created.code),
      /^CD-\d{4}-0001$/,
      `Code généré inattendu : ${created.code}`,
    );
  });

  const schoolCode = created.code;

  await check("2b. Le contact principal et le logo sont conservés", () => {
    assert.strictEqual(created.principalName, "Awa Kabila");
    assert.strictEqual(created.logoUrl, "https://cdn.somafrik.test/logo.png");
    assert.strictEqual(created.country, "RDC");
    assert.strictEqual(created.countryCode, "CD");
  });

  // ---------------------------------------------------------------------------
  // Étape 3 — L'établissement apparaît dans la liste (pour le superadmin).
  // ---------------------------------------------------------------------------
  await check("3. L'établissement apparaît dans la liste du superadmin", () => {
    const list = service.list(state, superAdmin);
    assert.ok(
      list.some((school) => school.code === schoolCode),
      "Établissement absent de la liste du superadmin.",
    );
  });

  // ---------------------------------------------------------------------------
  // Vérification métier — Le code établissement est unique.
  // ---------------------------------------------------------------------------
  await check("MÉTIER. Un code établissement en doublon est rejeté (400)", async () => {
    await expectBusinessError(
      () =>
        service.create(
          {
            name: "Autre École",
            country: "RDC",
            city: "Lubumbashi",
            type: "Collège",
            code: schoolCode, // même code
            phone: "+243 990 000 999",
            email: "autre@ecole.cd",
            principalName: "Jean Ot. ",
          },
          state,
          superAdmin,
          { force: true }, // on court-circuite la détection de doublon "flou" pour isoler le contrôle de code
        ),
      { statusCode: 400, messageIncludes: "code établissement existe déjà" },
    );
  });

  await check("MÉTIER. Un doublon potentiel (même email/téléphone) est signalé (409)", async () => {
    await expectBusinessError(
      () =>
        service.create(
          {
            name: "École Clone",
            country: "RDC",
            city: "Kinshasa",
            type: "Collège",
            phone: "+243 990 000 111", // même téléphone que l'établissement créé
            email: "contact@lycee-test.cd", // même email
            principalName: "Clone Resp.",
          },
          state,
          superAdmin,
        ),
      { statusCode: 409, messageIncludes: "Doublon potentiel" },
    );
  });

  // ---------------------------------------------------------------------------
  // Vérification métier — Visibilité restreinte aux utilisateurs autorisés.
  // ---------------------------------------------------------------------------
  await check("MÉTIER. Invisible pour un admin pays d'un autre pays (BI)", () => {
    const list = service.list(state, countryAdminBI);
    assert.ok(
      !list.some((school) => school.code === schoolCode),
      "L'établissement RDC ne doit pas être visible pour l'admin pays BI.",
    );
  });

  await check("MÉTIER. Invisible pour l'admin d'un autre établissement", async () => {
    const list = service.list(state, foreignSchoolAdmin);
    assert.ok(
      !list.some((school) => school.code === schoolCode),
      "L'établissement ne doit pas être visible pour l'admin d'une autre école.",
    );
    await expectBusinessError(() => service.get(schoolCode, state, foreignSchoolAdmin), {
      statusCode: 403,
    });
  });

  await check("MÉTIER. Un admin établissement ne peut pas créer d'établissement (403)", async () => {
    await expectBusinessError(
      () =>
        service.create(
          { name: "École Interdite", country: "RDC", city: "Goma", type: "Collège", phone: "1", email: "a@b.cd", principalName: "X" },
          state,
          foreignSchoolAdmin,
        ),
      { statusCode: 403 },
    );
  });

  // ---------------------------------------------------------------------------
  // On provisionne le compte de l'admin établissement (lié au code créé).
  // ---------------------------------------------------------------------------
  state = {
    ...state,
    users: [
      ...state.users,
      {
        id: "USR-ADMIN-1",
        publicId: "USR-ADMIN-1",
        identifier: "admin",
        firstName: "Admin",
        lastName: "Établissement",
        role: "Admin School",
        schoolCode,
        status: "Actif",
        accessChannel: "BackOffice",
        pin: "1234",
        password: "1234",
      },
    ],
  };

  // ---------------------------------------------------------------------------
  // Vérification métier — Établissement inactif ⇒ connexion impossible.
  // ---------------------------------------------------------------------------
  await check("MÉTIER. Établissement en attente : la connexion de l'admin est refusée (403)", async () => {
    const auth = buildAuthService(state, schoolCode);
    await expectBusinessError(
      () => auth.login({ role: "school_admin", schoolCode, identifier: "admin", pin: "1234" }),
      { statusCode: 403, messageIncludes: "attente de validation" },
    );
  });

  // ---------------------------------------------------------------------------
  // Étape 4 — Le superadmin active l'établissement.
  // ---------------------------------------------------------------------------
  await check("4. Le superadmin active l'établissement", () => {
    const result = service.activate(schoolCode, state, superAdmin);
    state = result.state;
    assert.strictEqual(result.school.status, "Actif");
    assert.strictEqual(result.school.validationStatus, "Validé");
  });

  // ---------------------------------------------------------------------------
  // Étape 5 — L'admin établissement peut se connecter avec le code.
  // ---------------------------------------------------------------------------
  await check("5. Après activation, l'admin établissement peut se connecter", async () => {
    const auth = buildAuthService(state, schoolCode);
    const session = await auth.login({ role: "school_admin", schoolCode, identifier: "admin", pin: "1234" });
    assert.strictEqual(session.role, "school_admin");
    assert.strictEqual(session.school.code, schoolCode);
    assert.strictEqual(session.user.schoolCode, schoolCode);
  });

  await check("5b. Un code établissement inconnu est rejeté à la connexion (401)", async () => {
    const auth = buildAuthService(state, schoolCode);
    await expectBusinessError(
      () => auth.login({ role: "school_admin", schoolCode: "CD-2026-0404", identifier: "admin", pin: "1234" }),
      { statusCode: 401 },
    );
  });

  // ---------------------------------------------------------------------------
  // Vérification métier — Suspension ⇒ connexion de nouveau bloquée.
  // ---------------------------------------------------------------------------
  await check("MÉTIER. Établissement suspendu : la connexion est de nouveau refusée (403)", async () => {
    const result = service.suspend(schoolCode, state, superAdmin);
    const suspendedState = result.state;
    const auth = buildAuthService(suspendedState, schoolCode);
    await expectBusinessError(
      () => auth.login({ role: "school_admin", schoolCode, identifier: "admin", pin: "1234" }),
      { statusCode: 403, messageIncludes: "suspendu" },
    );
  });

  // ---------------------------------------------------------------------------
  // Bilan.
  // ---------------------------------------------------------------------------
  console.log(`\nRésultat : ${passed} vérification(s) OK, ${failures.length} échec(s).\n`);
  if (failures.length) {
    process.exit(1);
  }
}

try {
  main().catch((error) => {
    console.error("Erreur inattendue durant le test E2E :", error);
    process.exit(1);
  });
} catch (error) {
  console.error("Erreur inattendue durant le test E2E :", error);
  process.exit(1);
}
