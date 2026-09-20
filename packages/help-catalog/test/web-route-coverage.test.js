import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  HELP_PLATFORM,
  HELP_ROLE,
  HELP_SCREEN,
  createHelpContext,
  filterHelpArticles,
  isHelpAvailable,
  resolveHelpScreen,
  suggestHelpArticles,
} from "../src/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const APP_TSX = fs.readFileSync(path.join(ROOT, "web/src/App.tsx"), "utf8");

function extractAppPathLiterals(source) {
  return Object.freeze([...source.matchAll(/path="([^"]+)"/g)].map((match) => match[1]));
}

const APP_PATHS = extractAppPathLiterals(APP_TSX);
const APP_ABSOLUTE_PATHS = Object.freeze(APP_PATHS.filter((item) => item.startsWith("/") || item === "*"));

/**
 * Routes publiques / auth : l’aide doit rester masquée (screen null).
 */
const PUBLIC_NULL_PATHS = Object.freeze([
  "/",
  "/connexion",
  "/demande-essai",
  "/confidentialite",
  "/suppression-compte",
  "/verify/rc/:capability",
]);

/**
 * Alias Navigate sans écran de séjour. HelpHost est monté (ProtectedRoute) mais
 * la navigation part immédiatement. Un mapping n’est pas exigé ; un null est
 * justifié. Certains alias matchent déjà un préfixe (`/administration/contacts`,
 * `/parametres-graphiques`) et conservent le bouton pendant le flash.
 */
const REDIRECT_ALIAS_PATHS = Object.freeze([
  "/classes",
  "/matieres",
  "/eleves",
  "/enseignants",
  "/contacts",
  "/administration/contacts",
  "/configuration/eleves",
  "/configuration/enseignants",
  "/configuration/utilisateurs",
  "/affectations",
  "/paiements",
  "/communication",
  "/communication/messages",
  "/communication/annonces",
  "/conception-bulletins",
  "/documents",
  "/utilisateurs",
  "/permissions",
  "/rapports",
  "/configuration",
  "/parametres-graphiques",
]);

const CATCH_ALL_PATHS = Object.freeze(["*"]);

/**
 * Bootstrap première configuration : pas d’aide in-app (écran d’accueil guidé).
 */
const BOOTSTRAP_NULL_PATHS = Object.freeze(["/bienvenue-etablissement"]);

/**
 * Écrans protégés où « Besoin d’aide ? » est attendu.
 * Toute nouvelle `path="/…"` dans App.tsx doit être classée ici, en public,
 * en alias Navigate, ou en catch-all — jamais oubliée.
 */
const PROTECTED_HELP_PATHS = Object.freeze({
  "/tableau-de-bord": HELP_SCREEN.DASHBOARD,
  "/etablissement": HELP_SCREEN.DASHBOARD,
  "/planning": HELP_SCREEN.PLANNING,
  "/finances": HELP_SCREEN.PAYMENTS,
  "/messages": HELP_SCREEN.MESSAGES,
  "/annonces": HELP_SCREEN.ANNOUNCEMENTS,
  "/presences": HELP_SCREEN.ATTENDANCE,
  "/notes": HELP_SCREEN.GRADES,
  "/examens": HELP_SCREEN.EXAMS,
  "/bulletins": HELP_SCREEN.REPORT_CARDS,
  "/bulletins/historique": HELP_SCREEN.REPORT_CARDS,
  "/bulletins/modele": HELP_SCREEN.REPORT_CARDS,
  "/notifications": HELP_SCREEN.NOTIFICATIONS,
  "/notifications-plateforme": HELP_SCREEN.NOTIFICATIONS,
  "/administration": HELP_SCREEN.USERS,
  "/parametres": HELP_SCREEN.SETTINGS,
  "/pays": HELP_SCREEN.PLATFORM,
  "/etablissements": HELP_SCREEN.PLATFORM,
  "/referentiels-pedagogiques": HELP_SCREEN.PLATFORM,
  "/abonnements": HELP_SCREEN.PLATFORM,
  "/marketplace": HELP_SCREEN.PLATFORM,
});

/** Sous-routes composées : le bouton ne doit pas disparaître. */
const PROTECTED_HELP_SUBPATHS = Object.freeze({
  "/etablissement/vue-ensemble": HELP_SCREEN.DASHBOARD,
  "/etablissement/classes": HELP_SCREEN.CLASSES,
  "/etablissement/classes/6A/eleves": HELP_SCREEN.STUDENTS,
  "/etablissement/eleves": HELP_SCREEN.STUDENTS,
  "/etablissement/eleves/stu-1": HELP_SCREEN.STUDENTS,
  "/etablissement/eleves/stu-1/notes": HELP_SCREEN.STUDENTS,
  "/etablissement/enseignants": HELP_SCREEN.TEACHERS,
  "/etablissement/comptes-utilisateurs": HELP_SCREEN.USERS,
  "/etablissement/relations-parent-enfant": HELP_SCREEN.DASHBOARD,
  "/etablissement/affectations": HELP_SCREEN.DASHBOARD,
  "/planning/emploi-du-temps": HELP_SCREEN.PLANNING,
  "/planning/emploi-du-temps/calendrier": HELP_SCREEN.PLANNING,
  "/planning/emploi-du-temps/par-classe": HELP_SCREEN.PLANNING,
  "/planning/salles": HELP_SCREEN.PLANNING,
  "/planning/remplacements": HELP_SCREEN.PLANNING,
  "/planning/conflits": HELP_SCREEN.PLANNING,
  "/finances/paiements": HELP_SCREEN.PAYMENTS,
  "/finances/frais": HELP_SCREEN.PAYMENTS,
  "/finances/impayes": HELP_SCREEN.PAYMENTS,
  "/administration/utilisateurs": HELP_SCREEN.USERS,
  "/administration/permissions": HELP_SCREEN.USERS,
  "/administration/documents": HELP_SCREEN.USERS,
  "/administration/conformite": HELP_SCREEN.USERS,
  "/administration/relations": HELP_SCREEN.USERS,
  "/parametres/profil": HELP_SCREEN.SETTINGS_PROFILE,
  "/parametres/annee-scolaire": HELP_SCREEN.SETTINGS_ACADEMIC_YEAR,
  "/parametres/structure": HELP_SCREEN.SETTINGS_STRUCTURE,
  "/parametres/roles-droits": HELP_SCREEN.SETTINGS_ROLES,
  "/parametres/donnees": HELP_SCREEN.SETTINGS_DATA,
  "/parametres/securite": HELP_SCREEN.SETTINGS_SECURITY,
  "/parametres/mon-abonnement": HELP_SCREEN.SETTINGS_SUBSCRIPTION,
  "/parametres/mon-abonnement/factures": HELP_SCREEN.SETTINGS_SUBSCRIPTION,
  "/parametres/configuration-etablissement": HELP_SCREEN.SETTINGS_SETUP,
  "/parametres/notifications": HELP_SCREEN.SETTINGS_NOTIFICATIONS,
  "/parametres/apparence": HELP_SCREEN.SETTINGS_COMING_SOON,
  "/parametres/integrations": HELP_SCREEN.SETTINGS_COMING_SOON,
  "/parametres/documents": HELP_SCREEN.SETTINGS,
  "/parametres/bulletins-configuration": HELP_SCREEN.SETTINGS,
  "/parametres/graphiques": HELP_SCREEN.SETTINGS,
  "/parametres/abonnements": HELP_SCREEN.SETTINGS,
  "/abonnements/offres": HELP_SCREEN.PLATFORM,
  "/abonnements/etablissements": HELP_SCREEN.PLATFORM,
  "/abonnements/paiements": HELP_SCREEN.PLATFORM,
  "/abonnements/factures": HELP_SCREEN.PLATFORM,
  "/abonnements/tarifs-pays": HELP_SCREEN.PLATFORM,
  "/bulletins/historique?tab=published": HELP_SCREEN.REPORT_CARDS,
  "/examens/": HELP_SCREEN.EXAMS,
});

function classifiedAbsolutePaths() {
  return new Set([
    ...PUBLIC_NULL_PATHS,
    ...REDIRECT_ALIAS_PATHS,
    ...CATCH_ALL_PATHS,
    ...BOOTSTRAP_NULL_PATHS,
    ...Object.keys(PROTECTED_HELP_PATHS),
  ]);
}

function schoolAdmin(pathname, extraPermissions = []) {
  return createHelpContext({
    platform: HELP_PLATFORM.WEB,
    role: "Administrateur d’établissement",
    pathname,
    permissions: [
      "Notes:READ",
      "Examens:READ",
      "Bulletins:READ",
      "Bulletins:CREATE",
      "Classes:READ",
      ...extraPermissions,
    ],
  });
}

test("every absolute App.tsx path is classified (anti-omission)", () => {
  const classified = classifiedAbsolutePaths();
  const missing = APP_ABSOLUTE_PATHS.filter((item) => !classified.has(item));
  assert.deepEqual(
    missing,
    [],
    `Routes App.tsx non classées (ajouter mapping ou exclusion explicite) : ${missing.join(", ")}`,
  );
});

test("classified absolute paths still exist in App.tsx", () => {
  const declared = new Set(APP_ABSOLUTE_PATHS);
  for (const item of classifiedAbsolutePaths()) {
    assert.equal(declared.has(item), true, `chemin classé absent de App.tsx : ${item}`);
  }
});

test("public and auth routes keep help unavailable", () => {
  const samples = [
    "/",
    "/connexion",
    "/connexion/reset",
    "/demande-essai",
    "/confidentialite",
    "/suppression-compte",
    "/verify/rc/foo",
    "/bienvenue-etablissement",
  ];
  for (const pathname of samples) {
    assert.equal(resolveHelpScreen({ platform: "web", pathname }), null, pathname);
    assert.equal(isHelpAvailable(schoolAdmin(pathname)), false, pathname);
  }
});

test("protected help-expected routes resolve to a screen (including Examens and Bulletins)", () => {
  const entries = { ...PROTECTED_HELP_PATHS, ...PROTECTED_HELP_SUBPATHS };
  for (const [pathname, screen] of Object.entries(entries)) {
    assert.equal(
      resolveHelpScreen({ platform: "web", pathname }),
      screen,
      pathname,
    );
    assert.equal(isHelpAvailable(schoolAdmin(pathname)), true, pathname);
  }
});

test("/examens is a distinct pedagogy screen and does not reuse Notes", () => {
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/examens" }), HELP_SCREEN.EXAMS);
  assert.notEqual(HELP_SCREEN.EXAMS, HELP_SCREEN.GRADES);
  assert.notEqual(
    resolveHelpScreen({ platform: "web", pathname: "/examens" }),
    HELP_SCREEN.GRADES,
  );
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/notes" }), HELP_SCREEN.GRADES);
});

test("Bulletins and sub-routes stay mapped to REPORT_CARDS", () => {
  for (const pathname of ["/bulletins", "/bulletins/historique", "/bulletins/modele", "/bulletins/"]) {
    assert.equal(resolveHelpScreen({ platform: "web", pathname }), HELP_SCREEN.REPORT_CARDS);
    assert.equal(isHelpAvailable(schoolAdmin(pathname)), true);
  }
});

test("Examens article is suggested on /examens and hidden without Examens:READ", () => {
  const withPerm = schoolAdmin("/examens");
  const suggestions = suggestHelpArticles(withPerm);
  assert.equal(
    suggestions.some((article) => article.id === "help/exams/sessions"),
    true,
  );
  assert.equal(
    suggestions.some((article) => article.id === "help/grades/evaluations"),
    false,
  );

  const withoutPerm = createHelpContext({
    platform: HELP_PLATFORM.WEB,
    role: "Administrateur d’établissement",
    pathname: "/examens",
    permissions: ["Notes:READ", "Bulletins:READ"],
  });
  assert.equal(isHelpAvailable(withoutPerm), true);
  assert.equal(
    filterHelpArticles(withoutPerm).some((article) => article.id === "help/exams/sessions"),
    false,
  );

  const teacherNoExam = createHelpContext({
    platform: HELP_PLATFORM.WEB,
    role: "Enseignant",
    pathname: "/examens",
    permissions: ["Notes:READ", "Notes:CREATE"],
  });
  assert.equal(
    filterHelpArticles(teacherNoExam).some((article) => article.id === "help/exams/sessions"),
    false,
  );
});

test("platform console routes keep help for operators without exposing school write procedures", () => {
  const operator = createHelpContext({
    platform: HELP_PLATFORM.WEB,
    role: "Super Administrateur Somafrik",
    pathname: "/pays",
    permissions: ["ALL_PRIVILEGES"],
  });
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/pays" }), HELP_SCREEN.PLATFORM);
  assert.equal(isHelpAvailable(operator), true);
  const ids = filterHelpArticles(operator).map((article) => article.id);
  assert.equal(ids.includes("help/platform/console"), true);
  assert.equal(ids.includes("help/classes/create"), false);
  assert.equal(ids.includes("help/exams/sessions"), false);

  const schoolOnPlatform = schoolAdmin("/pays");
  assert.equal(isHelpAvailable(schoolOnPlatform), true);
  assert.equal(
    filterHelpArticles(schoolOnPlatform).some((article) => article.id === "help/platform/console"),
    false,
  );
});

test("redirect aliases are explicit exclusions or prefix-mapped, never an accidental gap", () => {
  const prefixMapped = [];
  const nullOk = [];
  for (const pathname of REDIRECT_ALIAS_PATHS) {
    const screen = resolveHelpScreen({ platform: "web", pathname });
    if (screen) prefixMapped.push(pathname);
    else nullOk.push(pathname);
  }
  assert.ok(nullOk.includes("/classes"));
  assert.ok(nullOk.includes("/eleves"));
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/administration/contacts" }), HELP_SCREEN.USERS);
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/parametres-graphiques" }), HELP_SCREEN.SETTINGS);
  assert.ok(HELP_ROLE.SCHOOL_ADMIN);
});
