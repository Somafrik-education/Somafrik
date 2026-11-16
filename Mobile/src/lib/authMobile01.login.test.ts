/**
 * AUTH-MOBILE-01 — écran de connexion mobile (capture QA V2.0 Institut Nuruyetu).
 *   npx tsx Mobile/src/lib/authMobile01.login.test.ts
 *
 * Contrat croisé : le payload construit par le Mobile est rejoué contre le vrai
 * `AuthService.login` du backend (sans HTTP), pour chaque profil.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildMobileLoginPayload, usesPasswordLoginField } from "./platformLogin";
import {
  ERROR_MESSAGES,
  FORBIDDEN_LOGIN_MESSAGES,
  LOGIN_SCREEN_COPY,
  LOGIN_TEST_IDS,
  ROLE_SELECTION_COPY,
  classifyForbiddenLoginError,
  isUserFriendlyErrorMessage,
  mapIdentifyApiError,
  mapLoginApiError,
  resolveLoginFieldsError,
} from "./loginScreenSpec";
import { schoolHasLogo, schoolLogoDisplayUri, schoolLogoInitials } from "./schoolLogo";

const ROOT = path.join(__dirname, "..", "..", "..");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService, BusinessError } = require(path.join(ROOT, "backend/services/authService"));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { attachMemoryLoginLockoutStore } = require(path.join(ROOT, "backend/lib/loginLockout"));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { hashSecret } = require(path.join(ROOT, "backend/services/credentialService"));

const SCHOOL_A = {
  id: "school-nuru",
  code: "SCH-NURU",
  loginCode: "CD-IN-26-001",
  publicId: "CD-IN-26-001",
  name: "Institut Nuruyetu",
  city: "Kinshasa",
  country: "RDC",
  countryCode: "CD",
  status: "Actif",
  validationStatus: "Validé",
};
const SCHOOL_B = {
  ...SCHOOL_A,
  id: "school-other",
  code: "SCH-OTHER",
  loginCode: "CD-IN-26-002",
  publicId: "CD-IN-26-002",
  name: "Complexe scolaire Autre",
};

function account(overrides: Record<string, unknown>) {
  return {
    schoolCode: SCHOOL_A.code,
    accessChannel: "Application",
    status: "Actif",
    firstName: "Test",
    lastName: "Compte",
    ...overrides,
  };
}

function createService() {
  attachMemoryLoginLockoutStore();
  return new AuthService({
    school: SCHOOL_A,
    schools: [SCHOOL_A, SCHOOL_B],
    teachers: [],
    students: [],
    userAccounts: [
      account({ id: "U-STU", identifier: "eleve1", role: "Élève / Étudiant", passwordHash: hashSecret("Eleve2026!") }),
      account({ id: "U-TEA", identifier: "prof", role: "Enseignant", passwordHash: hashSecret("Prof2026!") }),
      account({ id: "U-PAR", identifier: "+243820000001", phone: "+243820000001", role: "Parent", passwordHash: hashSecret("Parent2026!") }),
      account({ id: "U-ADM", identifier: "admin", role: "Admin School", passwordHash: hashSecret("Admin2026!") }),
      account({
        id: "U-MULTI",
        identifier: "multi",
        role: "Enseignant",
        roleKeys: ["teacher", "parent"],
        passwordHash: hashSecret("Multi2026!"),
      }),
      account({ id: "U-OTHER", identifier: "autre", role: "Enseignant", schoolCode: SCHOOL_B.code, passwordHash: hashSecret("Autre2026!") }),
    ],
    countries: [],
    subscriptions: [],
  });
}

/** Simule exactement LoginScreen.handleLogin → buildMobileLoginPayload. */
function mobilePayload(role: string, identifier: string, secret: string, schoolCode = SCHOOL_A.loginCode) {
  return buildMobileLoginPayload({ role, identifier: identifier.trim(), password: secret.trim(), schoolCode });
}

async function rejectsWith(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: unknown) => {
    const e = error as { statusCode?: number };
    return error instanceof BusinessError && e.statusCode === status;
  });
}

type Case = { id: string; title: string; run: () => void | Promise<void> };

const cases: Case[] = [
  {
    id: "AUTH-M01-01",
    title: "Connexion Élève / Étudiant : password transmis, plus de « Champs manquants »",
    async run() {
      const service = createService();
      const identified = service.identify({ schoolCode: SCHOOL_A.loginCode, identifier: "eleve1" });
      assert.equal(identified.role, "student");
      assert.match(String(identified.roleLabel), /Élève|Étudiant/);
      const payload = mobilePayload(identified.role, "eleve1", "Eleve2026!");
      assert.equal(payload.password, "Eleve2026!");
      assert.equal(Object.prototype.hasOwnProperty.call(payload, "pin"), false);
      const session = await service.login(payload);
      assert.equal(session.role, "student");
    },
  },
  {
    id: "AUTH-M01-02",
    title: "Connexion Enseignant",
    async run() {
      const service = createService();
      const identified = service.identify({ schoolCode: SCHOOL_A.loginCode, identifier: "prof" });
      assert.equal(identified.role, "teacher");
      const session = await service.login(mobilePayload(identified.role, "prof", "Prof2026!"));
      assert.equal(session.role, "teacher");
    },
  },
  {
    id: "AUTH-M01-03",
    title: "Connexion Parent",
    async run() {
      const service = createService();
      const identified = service.identify({ schoolCode: SCHOOL_A.loginCode, identifier: "+243820000001" });
      assert.equal(identified.role, "parent_student");
      const payload = mobilePayload(identified.role, "+243820000001", "Parent2026!");
      assert.equal(Object.prototype.hasOwnProperty.call(payload, "pin"), false);
      const session = await service.login(payload);
      assert.equal(session.role, "parent_student");
    },
  },
  {
    id: "AUTH-M01-04",
    title: "Connexion Administrateur scolaire",
    async run() {
      const service = createService();
      const identified = service.identify({ schoolCode: SCHOOL_A.loginCode, identifier: "admin" });
      assert.equal(identified.role, "school_admin");
      const payload = mobilePayload(identified.role, "admin", "Admin2026!");
      assert.equal(payload.schoolCode, SCHOOL_A.loginCode);
      const session = await service.login(payload);
      assert.equal(session.role, "school_admin");
    },
  },
  {
    id: "AUTH-M01-05",
    title: "Identifiant vide / mot de passe vide : erreurs contextualisées locales",
    run() {
      assert.equal(resolveLoginFieldsError("", "secret"), ERROR_MESSAGES.emptyIdentifier);
      assert.equal(resolveLoginFieldsError("   ", "secret"), ERROR_MESSAGES.emptyIdentifier);
      assert.equal(resolveLoginFieldsError("eleve1", ""), ERROR_MESSAGES.emptyPassword);
      assert.equal(resolveLoginFieldsError("eleve1", "   "), ERROR_MESSAGES.emptyPassword);
      assert.equal(resolveLoginFieldsError("", ""), ERROR_MESSAGES.emptyFields);
      assert.equal(resolveLoginFieldsError("eleve1", "x"), null);
    },
  },
  {
    id: "AUTH-M01-06",
    title: "Identifiants incorrects → message générique, sans divulgation",
    async run() {
      const service = createService();
      await rejectsWith(service.login(mobilePayload("student", "eleve1", "mauvais")), 401);
      await rejectsWith(service.login(mobilePayload("teacher", "inconnu", "x")), 401);
      assert.equal(mapLoginApiError("Identifiant ou mot de passe incorrect", "student", 401), ERROR_MESSAGES.invalidCredentials);
      assert.equal(mapLoginApiError("", "teacher", 401), ERROR_MESSAGES.invalidCredentials);
      // « Champs manquants » n'est plus jamais relayé brut.
      assert.equal(mapLoginApiError("Champs manquants", "student", 400), ERROR_MESSAGES.invalidCredentials);
      assert.doesNotMatch(mapLoginApiError("Champs manquants", "student"), /Champs manquants/);
      assert.equal(mapLoginApiError("Compte temporairement verrouillé…", "teacher", 423), ERROR_MESSAGES.accountLocked);
      assert.equal(mapLoginApiError("Internal error at /api/login", "teacher", 500), ERROR_MESSAGES.serverUnavailable);
      assert.equal(
        mapLoginApiError("Etablissement suspendu. Connexion indisponible.", "teacher", 403),
        FORBIDDEN_LOGIN_MESSAGES.schoolSuspended,
      );
      assert.equal(mapLoginApiError("TypeError: undefined jwt stack", "teacher", 403), ERROR_MESSAGES.mobileAccessDenied);
    },
  },
  {
    id: "AUTH-M01-07",
    title: "Compte multirôle : rôle détecté transmis et accepté, second rôle exploitable",
    async run() {
      const service = createService();
      const identified = service.identify({ schoolCode: SCHOOL_A.loginCode, identifier: "multi" });
      assert.equal(identified.role, "teacher");
      assert.ok(Array.isArray(identified.roleKeys) && identified.roleKeys.length >= 2);
      const asTeacher = await service.login(mobilePayload("teacher", "multi", "Multi2026!"));
      assert.equal(asTeacher.role, "teacher");
      const parentPayload = mobilePayload("parent_student", "multi", "Multi2026!");
      assert.equal(parentPayload.password, "Multi2026!");
      const asParent = await service.login(parentPayload);
      assert.equal(asParent.role, "parent_student");
    },
  },
  {
    id: "AUTH-M01-08",
    title: "Isolation établissement : compte d'une autre école non identifiable ni connectable",
    async run() {
      const service = createService();
      assert.throws(
        () => service.identify({ schoolCode: SCHOOL_A.loginCode, identifier: "autre" }),
        (error: unknown) => error instanceof BusinessError && (error as { statusCode?: number }).statusCode === 404,
      );
      await rejectsWith(service.login(mobilePayload("teacher", "autre", "Autre2026!")), 401);
      // Mobile : même message neutre que pour un identifiant inexistant.
      assert.equal(
        mapIdentifyApiError("Aucun compte utilisateur trouvé. Contactez l'administration de l'établissement.", 404),
        ERROR_MESSAGES.invalidIdentifier,
      );
      assert.equal(
        mapIdentifyApiError("Ce compte utilisateur n'est pas autorisé sur l'application mobile.", 403),
        ERROR_MESSAGES.mobileAccessDenied,
      );
      assert.equal(mapIdentifyApiError("Impossible de joindre le serveur Somafrik."), ERROR_MESSAGES.networkError);
      assert.equal(mapIdentifyApiError("boom", 502), ERROR_MESSAGES.serverUnavailable);
    },
  },
  {
    id: "AUTH-M01-09",
    title: "Routage du secret : student/parent → password ; autres → pin (backend pin||password)",
    run() {
      assert.equal(usesPasswordLoginField("student"), true);
      assert.equal(usesPasswordLoginField("parent_student"), true);
      for (const role of ["teacher", "school_admin", "accountant", "super_admin"]) {
        assert.equal(usesPasswordLoginField(role), false, role);
        const payload = buildMobileLoginPayload({ role, identifier: "x", password: "S3cret!", schoolCode: SCHOOL_A.loginCode });
        assert.equal(payload.pin, "S3cret!", role);
      }
    },
  },
  {
    id: "AUTH-M01-10",
    title: "Consigne de connexion valable pour tous les profils (plus réservée aux enseignants)",
    run() {
      for (const text of [LOGIN_SCREEN_COPY.identifierHint, ROLE_SELECTION_COPY.nextStepHint]) {
        assert.doesNotMatch(text, /enseignant/i);
        assert.match(text, /identifiant/i);
        assert.ok(isUserFriendlyErrorMessage(text));
      }
      assert.doesNotMatch(ROLE_SELECTION_COPY.nextStepHint, /PIN/);
    },
  },
  {
    id: "AUTH-M01-11",
    title: "Logo établissement ou remplacement (initiales, jamais logo plateforme)",
    run() {
      const withLogo = {
        ...SCHOOL_A,
        hasLogo: true,
        logoSource: "school_upload",
        logoUploadedAt: "2026-11-01T10:00:00.000Z",
      };
      assert.equal(schoolHasLogo(withLogo), true);
      assert.equal(
        schoolLogoDisplayUri(withLogo, "https://api.example.test/api/"),
        "https://api.example.test/api/schools/CD-IN-26-001/logo",
      );
      assert.equal(schoolLogoDisplayUri({ ...SCHOOL_A, hasLogo: false }, "https://api.example.test/api"), null);
      assert.equal(schoolLogoInitials("Institut Nuruyetu"), "IN");
      assert.equal(schoolLogoInitials("Complexe scolaire de la Gombe"), "CS");
      assert.equal(schoolLogoInitials("École"), "E");
      assert.equal(schoolLogoInitials(""), "?");

      const component = fs.readFileSync(path.join(ROOT, "Mobile/src/components/SchoolLogoMark.tsx"), "utf8");
      assert.match(component, /onError=\{\(\) => setFailed\(true\)\}/);
      assert.doesNotMatch(component, /somafrik-logo/);
      const login = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/LoginScreen.tsx"), "utf8");
      assert.match(login, /<SchoolLogoMark/);
      assert.match(login, /LOGIN_TEST_IDS\.schoolLogoFallback/);
      assert.ok(LOGIN_TEST_IDS.schoolLogoFallback);
      const roleSelection = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/RoleSelectionScreen.tsx"), "utf8");
      assert.match(roleSelection, /<SchoolLogoMark/);
    },
  },
  {
    id: "AUTH-M01-12",
    title: "LoginScreen délègue le routage pin/password à buildMobileLoginPayload",
    run() {
      const login = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/LoginScreen.tsx"), "utf8");
      assert.match(login, /buildMobileLoginPayload\(\{[\s\S]{0,400}password: password\.trim\(\)/);
      assert.doesNotMatch(login, /\{ pin: password\.trim\(\) \}/);
      assert.match(login, /resolveLoginFieldsError\(identifier, password\)/);
      assert.match(login, /mapIdentifyApiError\(/);
    },
  },
  {
    id: "AUTH-M01-13",
    title: "403 : liste blanche de catégories métier, jamais le texte serveur brut",
    async run() {
      attachMemoryLoginLockoutStore();
      const allowed = new Set<string>(Object.values(FORBIDDEN_LOGIN_MESSAGES));
      const collect = async (school: Record<string, unknown>, user: Record<string, unknown>, mode: "identify" | "login") => {
        const service = new AuthService({
          school,
          schools: [school],
          teachers: [],
          students: [],
          userAccounts: [account({ id: "U-X", identifier: "cible", role: "Enseignant", passwordHash: hashSecret("Cible2026!"), ...user })],
          countries: [],
          subscriptions: [],
        });
        try {
          if (mode === "identify") service.identify({ schoolCode: SCHOOL_A.loginCode, identifier: "cible" });
          else await service.login(mobilePayload("teacher", "cible", "Cible2026!"));
        } catch (error) {
          const e = error as { statusCode?: number; message: string };
          assert.equal(e.statusCode, 403, e.message);
          return e.message;
        }
        throw new Error("403 attendu");
      };
      // Messages 403 réellement émis par le backend (AuthService non modifié).
      const real: Array<[string, string]> = [
        [await collect({ ...SCHOOL_A, status: "Suspendu" }, {}, "login"), "schoolSuspended"],
        [await collect({ ...SCHOOL_A, validationStatus: "En attente de validation" }, {}, "identify"), "schoolPendingValidation"],
        [await collect(SCHOOL_A, { status: "Inactif" }, "identify"), "accountInactive"],
        [await collect(SCHOOL_A, { status: "Suspendu" }, "login"), "accountInactive"],
        [await collect(SCHOOL_A, { accessChannel: "BackOffice" }, "identify"), "mobileAccessDenied"],
        // Textes backend non déclenchables sans fixture pays / abonnement (copiés de la source).
        ["Pays suspendu. Connexion indisponible pour ce pays.", "countrySuspended"],
        ["L'accès à la plateforme est suspendu pour cet établissement (abonnement expiré ou impayé).", "schoolSubscription"],
        ["L'accès est temporairement limité. Veuillez contacter l'administration de votre établissement ou régulariser l'abonnement.", "schoolSubscription"],
        ["Ce compte utilisateur n'est pas autorisé sur l'application mobile.", "mobileAccessDenied"],
      ];
      for (const [raw, category] of real) {
        assert.equal(classifyForbiddenLoginError(raw), category, raw);
        for (const shown of [mapLoginApiError(raw, "teacher", 403), mapIdentifyApiError(raw, 403)]) {
          assert.ok(allowed.has(shown), `hors liste blanche : ${shown}`);
          assert.equal(shown, FORBIDDEN_LOGIN_MESSAGES[category as keyof typeof FORBIDDEN_LOGIN_MESSAGES]);
        }
      }
      // Messages 403 arbitraires / sensibles : jamais relayés, même lisibles ou préfixés.
      const hostile = [
        "Accès refusé pour jean.dupont@ecole.cd (rôle Comptable, école SCH-OTHER)",
        "Etablissement suspendu. Détails : user_id=U-42, token=abc",
        "Compte suspendu par admin@somafrik.cd le 2026-11-01",
        "Forbidden",
        "",
        "Pays suspendu\nstack: at authService.js:788",
      ];
      for (const raw of hostile) {
        for (const shown of [mapLoginApiError(raw, "teacher", 403), mapIdentifyApiError(raw, 403)]) {
          assert.ok(allowed.has(shown), `hors liste blanche : ${shown}`);
          assert.doesNotMatch(shown, /@|U-42|token|SCH-OTHER|Comptable|stack|2026/);
        }
      }
      // Les deux constantes affichées passent le filtre technique historique.
      for (const text of allowed) assert.ok(isUserFriendlyErrorMessage(text), text);
    },
  },
];

(async () => {
  const failed: { id: string; message: string }[] = [];
  for (const testCase of cases) {
    try {
      await testCase.run();
      console.log(`  PASS ${testCase.id} ${testCase.title}`);
    } catch (error) {
      failed.push({ id: testCase.id, message: error instanceof Error ? error.message : String(error) });
      console.log(`  FAIL ${testCase.id} ${testCase.title}\n    ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`AUTH-MOBILE-01 — ${cases.length - failed.length} vert / ${failed.length} rouge / ${cases.length} cas`);
  if (failed.length) process.exit(1);
})();
