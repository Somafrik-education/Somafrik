import assert from "node:assert/strict";
import test from "node:test";

import {
  HELP_CATALOG,
  HELP_PLATFORM,
  HELP_ROLE,
  HELP_SCREEN,
  createHelpContext,
  filterHelpArticles,
  isHelpAvailable,
  navigationIsAllowed,
  normalizeHelpRole,
  popularHelpArticles,
  resolveHelpScreen,
  searchHelpArticles,
  sessionHasPermission,
  suggestHelpArticles,
} from "../src/index.js";

function schoolAdmin(overrides = {}) {
  return createHelpContext({
    platform: HELP_PLATFORM.WEB,
    role: "Admin School",
    pathname: "/etablissement/classes",
    permissions: [
      "Classes:READ",
      "Classes:CREATE",
      "Élèves:READ",
      "Élèves:CREATE",
      "Enseignants:READ",
      "Utilisateurs:READ",
      "Utilisateurs:CREATE",
      "Présences:READ",
      "Notes:READ",
      "Paiements:READ",
      "Paiements:CREATE",
      "Paramètres Établissement:READ",
    ],
    ...overrides,
  });
}

function teacher(overrides = {}) {
  return createHelpContext({
    platform: HELP_PLATFORM.MOBILE,
    role: "Enseignant",
    routeName: "TeacherAttendance",
    permissions: ["Classes:READ", "Élèves:READ", "Présences:READ", "Présences:UPDATE", "Notes:READ", "Notes:CREATE"],
    ...overrides,
  });
}

test("exposes a frozen catalog with unique help/* ids and required fields", () => {
  assert.equal(Object.isFrozen(HELP_CATALOG), true);
  assert.ok(HELP_CATALOG.length >= 20);

  const seen = Object.create(null);
  for (const article of HELP_CATALOG) {
    assert.equal(Object.isFrozen(article), true);
    assert.match(article.id, /^help\/[a-z0-9-]+\/[a-z0-9-]+$/);
    assert.equal(Object.hasOwn(seen, article.id), false);
    seen[article.id] = true;
    assert.equal(typeof article.title, "string");
    assert.ok(article.title.length > 0);
    assert.equal(typeof article.summary, "string");
    assert.ok(article.steps.length > 0);
    assert.ok(article.platforms.length > 0);
    assert.ok(article.routeKeys.length > 0);
    if (article.navigate) {
      assert.equal(article.navigate.level, "NAVIGATION");
      assert.notEqual(article.navigate.level, "ACTION");
    }
    for (const related of article.relatedArticles) {
      assert.equal(Object.hasOwn(seen, related) || HELP_CATALOG.some((item) => item.id === related), true, related);
    }
  }
});

test("normalizes live role labels to HELP role keys", () => {
  assert.equal(normalizeHelpRole("Admin School"), HELP_ROLE.SCHOOL_ADMIN);
  assert.equal(normalizeHelpRole("Administrateur d’établissement"), HELP_ROLE.SCHOOL_ADMIN);
  assert.equal(normalizeHelpRole("Enseignant"), HELP_ROLE.TEACHER);
  assert.equal(normalizeHelpRole("parent_student"), HELP_ROLE.PARENT);
  assert.equal(normalizeHelpRole("Préfet des études"), HELP_ROLE.PREFET_ETUDES);
  assert.equal(normalizeHelpRole("Super Administrateur Somafrik"), HELP_ROLE.SUPER_ADMIN);
  assert.equal(normalizeHelpRole("inconnu"), null);
});

test("hides help on vitrine, login, Support and bootstrap screens", () => {
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/" }), null);
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/connexion" }), null);
  assert.equal(resolveHelpScreen({ platform: "mobile", routeName: "Login" }), null);
  assert.equal(resolveHelpScreen({ platform: "mobile", routeName: "Welcome" }), null);
  assert.equal(resolveHelpScreen({ platform: "mobile", routeName: "Support" }), null);
  assert.equal(resolveHelpScreen({ platform: "mobile", routeName: "PermissionsBootstrap" }), null);
  assert.equal(isHelpAvailable(createHelpContext({ platform: "web", pathname: "/", role: "Admin School" })), false);
});

test("maps web paths and mobile routes to canonical screens", () => {
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/etablissement/classes" }), HELP_SCREEN.CLASSES);
  assert.equal(
    resolveHelpScreen({ platform: "web", pathname: "/etablissement/classes/CLS-1/eleves" }),
    HELP_SCREEN.STUDENTS,
  );
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/finances/paiements" }), HELP_SCREEN.PAYMENTS);
  assert.equal(resolveHelpScreen({ platform: "mobile", routeName: "Classes" }), HELP_SCREEN.CLASSES);
  assert.equal(
    resolveHelpScreen({ platform: "mobile", routeName: "Home", role: "Parent" }),
    HELP_SCREEN.PARENT_HOME,
  );
  assert.equal(
    resolveHelpScreen({ platform: "mobile", routeName: "Home", role: "Élève" }),
    HELP_SCREEN.STUDENT_HOME,
  );
});

test("createHelpContext strips PII fields and rejects secrets", () => {
  const context = createHelpContext({
    platform: "web",
    role: "teacher",
    pathname: "/presences",
    permissions: ["Présences:READ"],
    extra: "ignored",
  });
  assert.deepEqual(Object.keys(context).sort(), ["module", "permissions", "platform", "role", "screen"]);
  assert.equal(context.role, HELP_ROLE.TEACHER);
  assert.equal(context.screen, HELP_SCREEN.ATTENDANCE);
  assert.throws(
    () => createHelpContext({ platform: "web", role: "teacher", jwt: "secret", pathname: "/presences" }),
    /jwt/,
  );
  assert.throws(
    () => createHelpContext({ platform: "web", role: "teacher", studentId: "stu-1", pathname: "/presences" }),
    /studentId/,
  );
});

test("CRUD and ALL_PRIVILEGES satisfy required article permissions", () => {
  assert.equal(sessionHasPermission(["Classes:CRUD"], "Classes:READ"), true);
  assert.equal(sessionHasPermission(["Classes:CRUD"], "Classes:CREATE"), true);
  assert.equal(sessionHasPermission(["ALL_PRIVILEGES"], "Utilisateurs:CREATE"), true);
  assert.equal(sessionHasPermission(["Classes:READ"], "Classes:CREATE"), false);
});

test("teacher never sees create-user even with a leaked Utilisateurs:CREATE token if role is teacher", () => {
  const context = teacher({
    routeName: "Users",
    permissions: ["Utilisateurs:READ", "Utilisateurs:CREATE", "Classes:READ"],
  });
  const ids = filterHelpArticles(context).map((article) => article.id);
  assert.equal(ids.includes("help/users/create"), false);
  assert.equal(ids.includes("help/users/list"), false);
});

test("teacher without Utilisateurs permissions does not see user articles", () => {
  const ids = filterHelpArticles(teacher()).map((article) => article.id);
  assert.equal(ids.includes("help/users/create"), false);
  assert.equal(ids.includes("help/attendance/roll-call"), true);
  assert.equal(ids.includes("help/classes/create"), false);
});

test("school admin with Classes:READ but not CREATE sees list not create", () => {
  const context = schoolAdmin({
    permissions: ["Classes:READ", "Élèves:READ"],
  });
  const ids = filterHelpArticles(context).map((article) => article.id);
  assert.equal(ids.includes("help/classes/list"), true);
  assert.equal(ids.includes("help/classes/create"), false);
  assert.equal(ids.includes("help/students/enroll"), false);
});

test("super admin does not receive school operational articles from role allowlists", () => {
  const context = createHelpContext({
    platform: "web",
    role: "Super Administrateur Somafrik",
    pathname: "/tableau-de-bord",
    permissions: ["ALL_PRIVILEGES"],
  });
  const ids = filterHelpArticles(context).map((article) => article.id);
  assert.equal(ids.includes("help/classes/create"), false);
  assert.equal(ids.includes("help/users/create"), false);
  assert.equal(ids.includes("help/rbac/missing-action"), true);
});

test("parent only sees parent home and shared RBAC help", () => {
  const context = createHelpContext({
    platform: "mobile",
    role: "Parent",
    routeName: "Home",
    permissions: [],
  });
  const ids = filterHelpArticles(context).map((article) => article.id);
  assert.deepEqual(ids.sort(), ["help/parent/home", "help/rbac/missing-action"].sort());
});

test("suggestions are capped at 3 and stay on the current screen", () => {
  const context = schoolAdmin();
  const suggestions = suggestHelpArticles(context);
  assert.ok(suggestions.length <= 3);
  assert.ok(suggestions.every((article) => article.routeKeys.includes(HELP_SCREEN.CLASSES)));
});

test("search is local, accent-insensitive and still RBAC-filtered", () => {
  const adminHits = searchHelpArticles(schoolAdmin(), "créer utilisateur");
  assert.ok(adminHits.some((article) => article.id === "help/users/create"));

  const teacherHits = searchHelpArticles(teacher({ routeName: "Home" }), "créer utilisateur");
  assert.equal(
    teacherHits.some((article) => article.id === "help/users/create"),
    false,
  );

  const classHits = searchHelpArticles(schoolAdmin(), "classe");
  assert.ok(classHits.some((article) => article.id === "help/classes/list"));
});

test("empty search returns no hits; popular guides remain filtered", () => {
  assert.deepEqual(searchHelpArticles(schoolAdmin(), "   "), []);
  const popular = popularHelpArticles(schoolAdmin());
  assert.ok(popular.every((article) => article.popular));
  assert.ok(popular.length <= 3);
});

test("navigation stays NAVIGATION and requires the target permission", () => {
  const createClass = HELP_CATALOG.find((article) => article.id === "help/classes/create");
  assert.equal(navigationIsAllowed(createClass, schoolAdmin()), true);
  assert.equal(
    navigationIsAllowed(
      createClass,
      schoolAdmin({ permissions: ["Classes:READ"] }),
    ),
    false,
  );
  assert.ok(HELP_CATALOG.every((article) => article.navigate?.level !== "ACTION"));
});

test("web and mobile teacher-create procedures stay distinct", () => {
  const web = HELP_CATALOG.find((article) => article.id === "help/teachers/web-identity-from-users");
  const mobile = HELP_CATALOG.find((article) => article.id === "help/teachers/mobile-create");
  assert.deepEqual([...web.platforms], ["web"]);
  assert.deepEqual([...mobile.platforms], ["mobile"]);
  assert.ok(web.steps.some((step) => /Comptes utilisateurs/.test(step)));
  assert.ok(mobile.steps.some((step) => /Créer un enseignant/.test(step)));
});

test("catalog excludes parent-child write, vitrine support and Support alias", () => {
  const blob = HELP_CATALOG.map((article) => `${article.id}\n${article.title}\n${article.summary}\n${article.steps.join("\n")}`).join(
    "\n",
  );
  assert.doesNotMatch(blob, /Intercom|Crisp|Zendesk|OpenAI|Anthropic|google-services/i);
  assert.doesNotMatch(blob, /\/api\/help/);
  assert.doesNotMatch(blob, /Support\s*→\s*Messages/);
  assert.doesNotMatch(blob, /Nous contacter/);
  assert.equal(
    HELP_CATALOG.some((article) => article.id.includes("parent-child") || article.id.includes("parent-enfant")),
    false,
  );
  assert.ok(
    HELP_CATALOG.some((article) =>
      article.steps.some((step) => /ne décrit aucun parcours d’écriture pour lier un parent/.test(step)),
    ),
  );
});

test("does not index Notes write procedures still contradicted by KNOWN-ISSUES P1", () => {
  const ids = HELP_CATALOG.map((article) => article.id);
  assert.equal(ids.includes("help/grades/evaluations"), true);
  assert.equal(ids.includes("help/grades/create-evaluation"), false);
  assert.equal(ids.includes("help/grades/enter"), false);
  assert.equal(
    HELP_CATALOG.some((article) => article.title === "Créer une évaluation" || article.title === "Saisir les notes"),
    false,
  );

  const consultation = HELP_CATALOG.find((article) => article.id === "help/grades/evaluations");
  assert.ok(consultation.permissions.includes("Notes:READ"));
  assert.equal(consultation.permissions.includes("Notes:CREATE"), false);
  assert.equal(consultation.permissions.includes("Notes:UPDATE"), false);
  assert.equal(consultation.relatedArticles.includes("help/grades/create-evaluation"), false);
  assert.equal(consultation.relatedArticles.includes("help/grades/enter"), false);

  const teacherOnGrades = teacher({
    routeName: "TeacherGrades",
    permissions: ["Notes:READ", "Notes:CREATE", "Notes:UPDATE", "Classes:READ", "Élèves:READ"],
  });
  const hits = searchHelpArticles(teacherOnGrades, "saisir les notes");
  assert.equal(
    hits.some((article) => article.id === "help/grades/enter" || article.id === "help/grades/create-evaluation"),
    false,
  );
});
