/**
 * Audit Mobile — Profil Parent / parcours parent_student.
 *
 * Gate de régression Parent Mobile.
 *
 * Historique : ce fichier est né pendant l'audit #740 avec des RED attendus.
 * Depuis les correctifs P0/P1, tous les contrats ci-dessous doivent rester GREEN.
 *
 *   npx --yes tsx Mobile/src/lib/mobileParentProfile.audit.red.test.ts
 *   npm --prefix Mobile run test:mobile-parent-profile-audit
 *
 * Ne pas « vertir » ces assertions pour masquer un défaut.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canReadFeeGrids,
  canReadRoute,
  enrichSessionPermissions,
} from "../domain/security/permissions";
import {
  filterRowsByStudentScope,
  resolveMobileStudentScope,
  sessionStudentAliasKeys,
} from "./canonicalStudentIdentity";
import { getInternalRoleDefaults } from "./internalRoleDefaults";
import { canMutateC18Mobile } from "./studentEnrollmentC18Access";
import {
  LOGIN_SCREEN_COPY,
  mapKeyboardToInputMode,
  resolveSecretKeyboardType,
} from "./loginScreenSpec";
import { validateAccountSecret } from "./userAccountRules";
import { getRoleDrawerCatalog, getAllowedRoleDrawerItems } from "../navigation/roleDrawerPreferences";
import { getRoleTabCatalog, partitionRoleTabCatalog } from "../navigation/roleTabCatalog";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = path.join(srcRoot, "..");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

const CHILD_A1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CHILD_A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const CHILD_B1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const PARENT_A = "parent-a-user";
const SCHOOL_A = "CD-IN-26-001";
const SCHOOL_B = "CD-KN-26-009";

const PARENT_DEFAULT_PERMISSIONS = getInternalRoleDefaults("Parent");

function parentSession(overrides: Record<string, unknown> = {}) {
  return enrichSessionPermissions({
    role: "parent_student",
    roleKeys: ["PARENT"],
    permissions: PARENT_DEFAULT_PERMISSIONS,
    user: {
      id: PARENT_A,
      name: "Parent A",
      firstName: "Aline",
      lastName: "Kabila",
      phone: "+243820000001",
      schoolCode: SCHOOL_A,
      role: "Parent",
      roleKeys: ["PARENT"],
      permissions: PARENT_DEFAULT_PERMISSIONS,
      children: [
        { id: CHILD_A1, name: "Enfant A1", className: "6ème A", schoolCode: SCHOOL_A },
        { id: CHILD_A2, name: "Enfant A2", className: "5ème B", schoolCode: SCHOOL_A },
      ],
    },
    school: { code: SCHOOL_A, name: "École A" },
    ...overrides,
  });
}

const STAFF_ROUTES_FORBIDDEN_FOR_PARENT = [
  "TeacherGrades",
  "TeacherAttendance",
  "ClassGradesStats",
  "Payments",
  "FeeGrids",
  "Students",
  "Schooling",
  "Users",
  "Teachers",
  "SchoolManagement",
  "Unpaid",
  "Configuration",
  "EstablishmentProfile",
] as const;

const cases: { id: string; severity: "P0" | "P1" | "P2" | "INV"; title: string; run: () => void }[] = [
  {
    id: "MP-INV-01",
    severity: "INV",
    title: "Inventaire : onglets Parent = Profil / Notes / Présence / Frais",
    run() {
      const tabs = partitionRoleTabCatalog(parentSession()).visibleTabs;
      assert.deepEqual(
        tabs.map((tab) => tab.label),
        ["Profil", "Notes", "Présence", "Frais"],
      );
      assert.deepEqual(
        tabs.map((tab) => tab.route),
        ["ParentProfile", "Notes", "Presences", "FraisEleve"],
      );
    },
  },
  {
    id: "MP-INV-02",
    severity: "INV",
    title: "Inventaire : drawer Parent n'expose pas la section Admin",
    run() {
      const catalog = getRoleDrawerCatalog("parent_student");
      assert.equal(catalog.some((item) => item.section === "admin"), false);
      const items = getAllowedRoleDrawerItems(parentSession());
      assert.deepEqual(
        items.slice(0, 4).map((item) => item.label),
        ["Notes", "Présences", "Bulletins", "Paiements"],
      );
      assert.equal(items.some((item) => item.route === "Payments"), false);
      assert.equal(items.some((item) => item.route === "TeacherGrades"), false);
    },
  },
  {
    id: "MP-INV-03",
    severity: "INV",
    title: "Inventaire : le Parent dispose d'un profil compte dédié",
    run() {
      const tabs = read("navigation/roleTabPreferences.ts");
      assert.match(tabs, /ParentProfile:\s*ParentProfileScreen/);
      const screens = fs.readdirSync(path.join(srcRoot, "screens"));
      assert.equal(
        screens.some((name) => /ParentProfile|ProfilParent/i.test(name)),
        true,
        "ParentProfileScreen doit rester présent",
      );
      assert.doesNotMatch(
        tabs,
        /ParentProfile:\s*StudentDetailScreen/,
        "le profil Parent ne doit jamais revenir vers la fiche enfant",
      );
    },
  },
  {
    id: "MP-INV-04",
    severity: "INV",
    title: "Inventaire : parent sans enfant → 0 paiement (fail-closed déjà en place)",
    run() {
      const scope = resolveMobileStudentScope({
        role: "parent_student",
        selectedStudentId: null,
        children: [],
        user: { id: PARENT_A, children: [] },
      });
      const rows = filterRowsByStudentScope(
        [
          { studentId: CHILD_A1, amount: 10 },
          { studentId: CHILD_B1, amount: 99 },
        ],
        scope,
      );
      assert.equal(scope.unscoped, false);
      assert.equal(rows.length, 0);
    },
  },
  {
    id: "MP-001",
    severity: "P0",
    title: "Parent A ne doit jamais matcher l'enfant B1 via selectedStudentId / route param",
    run() {
      const keys = sessionStudentAliasKeys({
        role: "parent_student",
        selectedStudentId: CHILD_B1,
        user: {
          id: PARENT_A,
          children: [
            { id: CHILD_A1 },
            { id: CHILD_A2 },
          ],
        },
      });
      assert.equal(
        keys.includes(CHILD_B1),
        false,
        `sessionStudentAliasKeys inclut l'élève étranger ${CHILD_B1} (clés=${JSON.stringify(keys)})`,
      );
      const scope = resolveMobileStudentScope({
        role: "parent_student",
        selectedStudentId: CHILD_B1,
        children: [{ id: CHILD_A1 }, { id: CHILD_A2 }],
        user: { id: PARENT_A, children: [{ id: CHILD_A1 }, { id: CHILD_A2 }] },
      });
      const leaked = filterRowsByStudentScope(
        [
          { studentId: CHILD_A1, amount: 10 },
          { studentId: CHILD_B1, amount: 80_000 },
        ],
        scope,
      );
      assert.equal(
        leaked.some((row) => row.studentId === CHILD_B1),
        false,
        "un studentId étranger dans selectedStudentId fait fuiter la ligne B1 côté client",
      );
    },
  },
  {
    id: "MP-002",
    severity: "P0",
    title: "Parent école A ne doit pas aliaser un élève de l'école B",
    run() {
      const keys = sessionStudentAliasKeys({
        role: "parent_student",
        selectedStudentId: CHILD_B1,
        user: {
          id: PARENT_A,
          children: [{ id: CHILD_A1 }],
        },
      });
      assert.equal(keys.includes(CHILD_B1), false);
      assert.equal(keys.includes(SCHOOL_B), false);
    },
  },
  {
    id: "MP-003",
    severity: "P0",
    title: "Parent defaults : canReadRoute interdit les surfaces admin/enseignant/finance staff",
    run() {
      const session = parentSession();
      const opened = STAFF_ROUTES_FORBIDDEN_FOR_PARENT.filter((route) =>
        route === "FeeGrids" ? canReadFeeGrids(session) : canReadRoute(session, route),
      );
      assert.deepEqual(
        opened,
        [],
        `Parent ouvre encore des routes staff: ${opened.join(", ")}`,
      );
    },
  },
  {
    id: "MP-004",
    severity: "P0",
    title: "AppNavigator ne doit pas enregistrer Payments/FeeGrids pour un Parent (canOpenAdminScreens)",
    run() {
      const session = parentSession();
      const canOpenAdminScreens =
        canReadRoute(session, "SchoolManagement") ||
        canReadRoute(session, "Teachers") ||
        canReadRoute(session, "Payments") ||
        canReadRoute(session, "Unpaid") ||
        canReadFeeGrids(session);
      assert.equal(
        canOpenAdminScreens,
        false,
        "canOpenAdminScreens est vrai pour un Parent (Paiements:READ ouvre Payments/FeeGrids)",
      );
      const nav = read("navigation/AppNavigator.tsx");
      assert.match(nav, /canOpenAdminScreens/);
      assert.match(nav, /canReadRoute\(session, "Payments"\)/);
      assert.match(nav, /canReadRoute\(session, "TeacherGrades"\)/);
      assert.match(nav, /canReadRoute\(session, "Students"\)/);
    },
  },
  {
    id: "MP-005",
    severity: "P0",
    title: "PaymentsScreen / StudentsScreen doivent filtrer le périmètre enfant Parent",
    run() {
      const payments = read("screens/PaymentsScreen.tsx");
      assert.match(
        payments,
        /filterRowsByStudentScope|resolveMobileStudentScope/,
        "PaymentsScreen n'applique aucun scope enfant — dataset hydraté affiché tel quel",
      );
      const students = read("screens/StudentsScreen.tsx");
      assert.match(
        students,
        /session\?\.user\.children|filterRowsByStudentScope/,
        "StudentsScreen ne borne pas la liste aux enfants du Parent",
      );
    },
  },
  {
    id: "MP-006",
    severity: "P1",
    title: "canMutateC18Mobile(parent_student) doit rester false même avec Élèves:UPDATE",
    run() {
      assert.equal(
        canMutateC18Mobile({
          role: "parent_student",
          permissions: ["Élèves:UPDATE", "Élèves:READ"],
          user: { role: "Parent", permissions: ["Élèves:UPDATE"] },
        }),
        false,
        "parent_student n'est pas dans PARENT_STUDENT_ROLES — C18 UI peut s'ouvrir",
      );
    },
  },
  {
    id: "MP-007",
    severity: "P1",
    title: "Écran Profil Parent (compte) doit exister et ne pas être la fiche enfant",
    run() {
      const screens = fs.readdirSync(path.join(srcRoot, "screens"));
      assert.ok(
        screens.some((name) => /ParentProfile|ProfilParent/i.test(name)),
        "aucun écran Profil Parent — l'onglet Profil ouvre StudentDetailScreen",
      );
    },
  },
  {
    id: "MP-008",
    severity: "P1",
    title: "Notes/Présences/Paiements doivent suivre le switcher, pas un studentId de route figé",
    run() {
      const notes = read("screens/StudentNotesScreen.tsx");
      const presences = read("screens/StudentPresencesScreen.tsx");
      const payments = read("screens/StudentPaymentsScreen.tsx");
      const detail = read("screens/StudentDetailScreen.tsx");
      for (const [label, src] of [
        ["StudentNotesScreen", notes],
        ["StudentPresencesScreen", presences],
        ["StudentPaymentsScreen", payments],
        ["StudentDetailScreen", detail],
      ] as const) {
        assert.equal(
          /route\?\.params\?\.studentId\s*\?\?\s*selectedStudentId/.test(src),
          false,
          `${label} priorise route.params.studentId sur le switcher — enfant figé après changement`,
        );
      }
    },
  },
  {
    id: "MP-009",
    severity: "P1",
    title: "Drawer Parent « Paiements » doit ouvrir StudentPayments, pas MobilePayment MVP",
    run() {
      const drawer = read("navigation/roleDrawerPreferences.ts");
      const start = drawer.indexOf("const parentItems");
      const end = drawer.indexOf("const studentItems");
      assert.ok(start >= 0 && end > start, "blocs parentItems / studentItems introuvables");
      const parentBlock = drawer.slice(start, end);
      assert.equal(
        /quotidien\(I\.mobilePayment\)/.test(parentBlock),
        false,
        "drawer Parent pointe encore I.mobilePayment (écran MVP)",
      );
      assert.match(
        parentBlock,
        /quotidien\(I\.studentPayments\)/,
        "drawer Parent n'ouvre pas StudentPayments",
      );
    },
  },
  {
    id: "MP-010",
    severity: "P1",
    title: "StudentPresencesScreen doit exposer loading / erreur / offline / retry sans faux empty",
    run() {
      const src = read("screens/StudentPresencesScreen.tsx");
      assert.match(src, /QueryStateView/, "pas de QueryStateView — vide et erreur indistinguables");
      assert.match(
        src,
        /presencesSnapshot\.status\s*!==\s*"success"/,
        "la liste est rendue avant succès — loading/error/offline peuvent être masqués",
      );
      assert.match(src, /emptyMessage=\{DATA_TRUTH_COPY\.emptyPresences\}/);
      assert.match(src, /errorMessage=\{DATA_TRUTH_COPY\.errorPresences\}/);
      assert.match(src, /offlineMessage=\{DATA_TRUTH_COPY\.offlinePresences\}/);
      assert.match(
        src,
        /onRetry=\{\(\) => void loadPresences\(\)\}/,
        "Retry n'est pas relié à loadPresences()",
      );
      const truth = read("lib/dataTruth.ts");
      assert.match(truth, /emptyPresences:/);
      assert.match(truth, /errorPresences:/);
      assert.match(truth, /offlinePresences:/);
      assert.match(truth, /presencesEmpty:/);
      assert.match(truth, /presencesError:/);
    },
  },
  {
    id: "MP-010B",
    severity: "P1",
    title: "Bulletins Mobile Parent doit exposer le StudentSwitcher sans contourner le scope enfant",
    run() {
      const src = read("screens/ReportCardsScreen.tsx");
      assert.match(src, /import StudentSwitcher from "\.\.\/components\/StudentSwitcher"/);
      assert.match(src, /isParentView\s*\?\s*<StudentSwitcher\s*\/>\s*:\s*null/);
      assert.match(src, /resolveMobileStudentScope\(\{[\s\S]*selectedStudentId/);
      assert.match(src, /filterRowsByStudentScope\(reportCardsSnapshot\.data, studentScope\)/);
      assert.match(
        src,
        /role !== "parent_student"[\s\S]*role !== "parent"/,
        "workflow staff ne doit pas redevenir visible au Parent",
      );
    },
  },
  {
    id: "MP-011",
    severity: "P1",
    title: "Logout vide l'état Parent immédiatement et purge SecureStore via logoutSession",
    run() {
      const auth = read("context/AuthContext.tsx");
      assert.match(auth, /setSelectedStudentId\(null\)/);
      const logoutFn = auth.slice(auth.indexOf("const logout = useCallback"));
      assert.match(
        logoutFn,
        /clearAuthenticatedState\(\)/,
        "logout() doit vider immédiatement la session mémoire et selectedStudentId",
      );
      assert.match(
        logoutFn,
        /logoutSession\(\)/,
        "logout() doit déléguer la révocation/purge locale à services\/api.logout",
      );
      const api = read("services/api.ts");
      const apiLogout = api.slice(api.indexOf("export async function logout()"));
      assert.match(
        apiLogout,
        /finally\s*\{[\s\S]*await clearSecureSession\(\)/,
        "services/api.logout doit toujours purger SecureStore dans finally",
      );
    },
  },
  {
    id: "MP-012",
    severity: "P1",
    title: "StudentDetail refuse un studentId Parent hors enfants liés avant GET",
    run() {
      const src = read("screens/StudentDetailScreen.tsx");
      assert.match(
        src,
        /resolveParentSafeStudentId\(\{[\s\S]*routeStudentId:[\s\S]*selectedStudentId:[\s\S]*user:\s*session\?\.user/,
        "StudentDetail doit résoudre l'id via le helper Parent fail-closed",
      );
      assert.match(
        src,
        /if\s*\(!studentId\)\s*\{[\s\S]*return;/,
        "StudentDetail doit stopper le chargement sans id enfant autorisé",
      );
      assert.match(
        src,
        /isLinkedParentStudent\(\{\s*user:\s*session\.user,\s*selectedStudentId:\s*requested\s*\}\)/,
        "un deep-link étranger doit être recoupé aux enfants liés",
      );
    },
  },
  {
    id: "MP-013",
    severity: "P2",
    title: "Les artefacts legacy Parent PIN doivent rester supprimés",
    run() {
      assert.equal(
        fs.existsSync(path.join(srcRoot, "models/Parent.ts")),
        false,
        "Mobile/src/models/Parent.ts legacy ne doit pas réapparaître",
      );
      assert.equal(
        fs.existsSync(path.join(srcRoot, "test.ts")),
        false,
        "Mobile/src/test.ts legacy ne doit pas réapparaître",
      );
    },
  },
  {
    id: "MP-014",
    severity: "P0",
    title: "Authentification Parent : mot de passe standard, pas un PIN number-pad",
    run() {
      assert.equal(
        validateAccountSecret("Pass1234"),
        null,
        "précondition : Pass1234 est un secret canonique valide (8 + lettre + chiffre)",
      );
      assert.notEqual(
        resolveSecretKeyboardType("parent_student"),
        "number-pad",
        "Parent impose number-pad — un secret valide avec lettres n'est pas saisissable",
      );
      assert.equal(
        resolveSecretKeyboardType("parent_student"),
        resolveSecretKeyboardType("school_admin"),
        "Parent et staff doivent partager le même clavier mot de passe",
      );
      assert.equal(mapKeyboardToInputMode(resolveSecretKeyboardType("parent_student")), "text");
      assert.notEqual(
        LOGIN_SCREEN_COPY.pinLabel,
        "PIN",
        "le contrat UI Parent expose encore le wording PIN",
      );
      const login = read("screens/LoginScreen.tsx");
      assert.doesNotMatch(
        login,
        /identity\.role === "parent_student"[\s\S]{0,120}LOGIN_SCREEN_COPY\.pinLabel/,
        "LoginScreen branche encore pinLabel pour parent_student",
      );
    },
  },
];

const failed: { id: string; severity: string; title: string; message: string }[] = [];
const passedIds: string[] = [];
for (const testCase of cases) {
  try {
    testCase.run();
    passedIds.push(testCase.id);
  } catch (error) {
    failed.push({
      id: testCase.id,
      severity: testCase.severity,
      title: testCase.title,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const failedIds = failed.map((item) => item.id);
const p0Failed = failed.filter((item) => item.severity === "P0").map((item) => item.id);
const p1Failed = failed.filter((item) => item.severity === "P1").map((item) => item.id);
const p2Failed = failed.filter((item) => item.severity === "P2").map((item) => item.id);

console.log(
  `mobile parent profile audit — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`,
);
for (const id of passedIds) console.log(`  PASS ${id}`);
for (const item of failed) {
  console.log(`  FAIL [${item.severity} ${item.id}] ${item.title}`);
  console.log(`    ${item.message}`);
}
console.log(
  `MOBILE_PARENT_PROFILE_AUDIT_REPORT ${JSON.stringify({
    passedIds,
    failedIds,
    p0Failed,
    p1Failed,
    p2Failed,
    expectedIds: cases.map((item) => item.id),
    mobileRoot,
  })}`,
);

if (failed.length) process.exit(1);
console.log("OK: audit Parent Mobile — tous les contrats sont verts");
