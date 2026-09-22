import assert from "node:assert/strict";
import test from "node:test";

import {
  HELP_CATALOG,
  HELP_CATEGORY,
  HELP_CATEGORY_ORDER,
  HELP_PLATFORM,
  HELP_ROLE,
  HELP_SCREEN,
  createHelpContext,
  filterHelpArticles,
  groupHelpArticlesByCategory,
  resolveHelpScreen,
  searchHelpArticles,
  suggestHelpArticles,
} from "../src/index.js";

const REQUIRED_IDS = Object.freeze([
  "help/start/first-login",
  "help/start/navigation",
  "help/start/school-setup",
  "help/start/quick-config",
  "help/classes/head-teacher",
  "help/classes/head-teacher-assign",
  "help/students/enroll",
  "help/students/mobile-record",
  "help/attendance/roll-call",
  "help/report-cards/consult",
  "help/exams/sessions",
  "help/platform/console",
  "help/payments/unpaid",
  "help/settings/notifications",
  "help/account/password",
  "help/account/logout",
  "help/account/privacy",
  "help/assistance/contact",
]);

const FORBIDDEN_IDS = Object.freeze([
  "help/grades/create-evaluation",
  "help/grades/enter",
  "help/students/create-global",
  "help/parent-enfant/write",
]);

function schoolAdmin(overrides = {}) {
  return createHelpContext({
    platform: HELP_PLATFORM.WEB,
    role: "Admin School",
    pathname: "/tableau-de-bord",
    permissions: [
      "Classes:READ",
      "Classes:CREATE",
      "Classes:UPDATE",
      "Élèves:READ",
      "Élèves:CREATE",
      "Enseignants:READ",
      "Utilisateurs:READ",
      "Utilisateurs:CREATE",
      "Présences:READ",
      "Présences:UPDATE",
      "Notes:READ",
      "Examens:READ",
      "Bulletins:READ",
      "Paiements:READ",
      "Paiements:CREATE",
      "Impayés:READ",
      "Messages:READ",
      "Paramètres Établissement:READ",
      "Paramètres Établissement:UPDATE",
    ],
    ...overrides,
  });
}

function teacher(overrides = {}) {
  return createHelpContext({
    platform: HELP_PLATFORM.MOBILE,
    role: "Enseignant",
    routeName: "TeacherAttendance",
    permissions: ["Classes:READ", "Élèves:READ", "Présences:READ", "Présences:UPDATE", "Notes:READ", "Bulletins:READ"],
    ...overrides,
  });
}

function articleBlob(id) {
  const article = HELP_CATALOG.find((item) => item.id === id);
  assert.ok(article, id);
  return `${article.title}\n${article.summary}\n${article.steps.join("\n")}`;
}

test("every article has a known category and unique help/* id", () => {
  const seen = Object.create(null);
  for (const article of HELP_CATALOG) {
    assert.equal(Object.hasOwn(seen, article.id), false, article.id);
    seen[article.id] = true;
    assert.equal(HELP_CATEGORY_ORDER.includes(article.category), true, article.id);
    assert.equal(typeof article.order, "number");
  }
});

test("required user-guide articles exist and forbidden legacy ids stay absent", () => {
  const ids = HELP_CATALOG.map((article) => article.id);
  for (const id of REQUIRED_IDS) {
    assert.equal(ids.includes(id), true, `manquant : ${id}`);
  }
  for (const id of FORBIDDEN_IDS) {
    assert.equal(ids.includes(id), false, `legacy interdit : ${id}`);
  }
  assert.equal(
    HELP_CATALOG.some((article) => /ajouter un élève/i.test(article.title)),
    false,
  );
});

test("school admin sees required categories; teacher does not see finance or school setup", () => {
  const adminGroups = groupHelpArticlesByCategory(schoolAdmin());
  const adminLabels = adminGroups.map((group) => group.label);
  for (const label of [
    "Démarrage",
    "Établissement",
    "Utilisateurs et accès",
    "Scolarité",
    "Enseignants",
    "Présences",
    "Pédagogie",
    "Finance",
    "Communication",
    "Compte et sécurité",
    "Assistance",
  ]) {
    assert.equal(adminLabels.includes(label), true, label);
  }

  const teacherGroups = groupHelpArticlesByCategory(teacher());
  const teacherLabels = teacherGroups.map((group) => group.label);
  assert.equal(teacherLabels.includes("Présences"), true);
  assert.equal(teacherLabels.includes("Finance"), false);
  assert.equal(teacherLabels.includes("Établissement"), false);
  const teacherIds = filterHelpArticles(teacher()).map((article) => article.id);
  assert.equal(teacherIds.includes("help/start/school-setup"), false);
  assert.equal(teacherIds.includes("help/users/create"), false);
  assert.equal(teacherIds.includes("help/attendance/roll-call"), true);
});

test("superadmin does not receive establishment operational write guides", () => {
  const ids = filterHelpArticles(
    createHelpContext({
      platform: "web",
      role: "Super Administrateur Somafrik",
      pathname: "/tableau-de-bord",
      permissions: ["ALL_PRIVILEGES"],
    }),
  ).map((article) => article.id);
  assert.equal(ids.includes("help/classes/create"), false);
  assert.equal(ids.includes("help/start/school-setup"), false);
  assert.equal(ids.includes("help/assistance/contact"), true);
});

test("contextual help from classes, attendance, finance and setup", () => {
  const classes = suggestHelpArticles(schoolAdmin({ pathname: "/etablissement/classes" }));
  assert.ok(classes.some((article) => article.id === "help/classes/list" || article.id === "help/classes/head-teacher"));

  const attendance = suggestHelpArticles(schoolAdmin({ pathname: "/presences" }));
  assert.ok(attendance.some((article) => article.routeKeys.includes(HELP_SCREEN.ATTENDANCE)));
  assert.ok(attendance.some((article) => /appel|présence/i.test(article.title)));

  const setup = suggestHelpArticles(
    schoolAdmin({ pathname: "/parametres/configuration-etablissement" }),
  );
  assert.ok(setup.some((article) => article.id === "help/start/school-setup"));

  const mobileAttendance = suggestHelpArticles(teacher());
  assert.ok(mobileAttendance.some((article) => article.id === "help/attendance/roll-call"));
});

test("search terms reach relevant role-filtered articles", () => {
  const admin = schoolAdmin();
  const cases = [
    ["élève", "help/students/directory"],
    ["paiement", "help/payments/overview"],
    ["présence", "help/attendance/choose-class"],
    ["professeur", "help/teachers/list"],
    ["mot de passe", "help/account/password"],
    ["bulletin", "help/report-cards/consult"],
    ["examen", "help/exams/sessions"],
    ["message", "help/communication/messages"],
    ["classe", "help/classes/list"],
  ];
  for (const [query, expectedId] of cases) {
    const hits = searchHelpArticles(admin, query);
    assert.equal(
      hits.some((article) => article.id === expectedId),
      true,
      `${query} → ${expectedId}`,
    );
  }

  const teacherHits = searchHelpArticles(teacher({ routeName: "Home" }), "paiement");
  assert.equal(
    teacherHits.some((article) => article.id === "help/payments/record"),
    false,
  );
});

test("school setup and head teacher copy matches current UI labels", () => {
  const setup = articleBlob("help/start/school-setup");
  assert.match(setup, /Assistant de configuration/);
  assert.match(setup, /Configuration de l’établissement/);
  assert.match(setup, /Plus tard/);
  assert.match(setup, /Étape précédente requise/);
  assert.match(setup, /n’existe pas d’ouverture automatique/);

  const head = articleBlob("help/classes/head-teacher");
  assert.match(head, /Professeur principal :/);
  assert.match(head, /Non assigné/);

  const assign = articleBlob("help/classes/head-teacher-assign");
  assert.match(assign, /Affecter un professeur principal/);
  assert.match(assign, /Confirmer l'affectation/);
});

test("enrollment stays class-scoped and notes write procedures stay unpublished", () => {
  const enroll = articleBlob("help/students/enroll");
  assert.match(enroll, /Inscrire un élève/);
  assert.doesNotMatch(enroll, /Ajouter un élève/);
  const blob = HELP_CATALOG.map((article) => `${article.id}\n${article.title}\n${article.steps.join("\n")}`).join("\n");
  assert.doesNotMatch(blob, /help\/grades\/create-evaluation/);
  assert.doesNotMatch(blob, /Intercom|Crisp|Zendesk|OpenAI/);
  assert.doesNotMatch(blob, /\/api\/help/);
  assert.doesNotMatch(blob, /Nous contacter/);
});

test("assistance article is available to authenticated school roles without leaking platform support SDKs", () => {
  const article = HELP_CATALOG.find((item) => item.id === "help/assistance/contact");
  assert.equal(article.title, "Je n’ai pas trouvé la réponse");
  assert.equal(article.category, HELP_CATEGORY.ASSISTANCE);
  assert.match(articleBlob("help/assistance/contact"), /administration de votre établissement/);
  assert.equal(filterHelpArticles(schoolAdmin()).some((item) => item.id === "help/assistance/contact"), true);
  assert.equal(filterHelpArticles(teacher()).some((item) => item.id === "help/assistance/contact"), true);
});

test("maps new web paths and mobile routes to canonical screens", () => {
  assert.equal(
    resolveHelpScreen({ platform: "web", pathname: "/parametres/configuration-etablissement" }),
    HELP_SCREEN.SETTINGS_SETUP,
  );
  assert.equal(
    resolveHelpScreen({ platform: "web", pathname: "/bulletins" }),
    HELP_SCREEN.REPORT_CARDS,
  );
  assert.equal(
    resolveHelpScreen({ platform: "web", pathname: "/bulletins/historique" }),
    HELP_SCREEN.REPORT_CARDS,
  );
  assert.equal(
    resolveHelpScreen({ platform: "web", pathname: "/bulletins/modele" }),
    HELP_SCREEN.REPORT_CARDS,
  );
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/examens" }), HELP_SCREEN.EXAMS);
  assert.notEqual(resolveHelpScreen({ platform: "web", pathname: "/examens" }), HELP_SCREEN.GRADES);
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/pays" }), HELP_SCREEN.PLATFORM);
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/etablissements" }), HELP_SCREEN.PLATFORM);
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/etablissement" }), HELP_SCREEN.DASHBOARD);
  assert.equal(
    resolveHelpScreen({ platform: "web", pathname: "/parametres/notifications" }),
    HELP_SCREEN.SETTINGS_NOTIFICATIONS,
  );
  assert.equal(resolveHelpScreen({ platform: "mobile", routeName: "SchoolSetup" }), HELP_SCREEN.SETTINGS_SETUP);
  assert.equal(resolveHelpScreen({ platform: "mobile", routeName: "ReportCards" }), HELP_SCREEN.REPORT_CARDS);
  assert.equal(resolveHelpScreen({ platform: "mobile", routeName: "Unpaid" }), HELP_SCREEN.PAYMENTS);
  assert.equal(resolveHelpScreen({ platform: "mobile", routeName: "Support" }), null);
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/connexion" }), null);
});

test("fictional finance amounts are labelled as such", () => {
  const unpaid = articleBlob("help/payments/unpaid");
  assert.match(unpaid, /fictif/i);
  assert.match(unpaid, /Total restant/);
});
