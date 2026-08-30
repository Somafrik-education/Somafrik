import assert from "node:assert/strict";
import test from "node:test";

import {
  HELP_CATALOG,
  HELP_PLATFORM,
  HELP_SCREEN,
  createHelpContext,
  filterHelpArticles,
  resolveHelpScreen,
  searchHelpArticles,
  suggestHelpArticles,
} from "../src/index.js";

const SETTINGS_READ_ARTICLE_IDS = Object.freeze([
  "help/settings/overview",
  "help/settings/profile",
  "help/settings/academic-year",
  "help/settings/academic-periods",
  "help/settings/grading-configuration",
  "help/settings/pedagogical-structure",
  "help/settings/roles-permissions",
  "help/settings/finance",
  "help/settings/data-export",
  "help/settings/subscription",
  "help/settings/security",
  "help/settings/coming-soon",
]);

const SETTINGS_WRITE_ARTICLE_IDS = Object.freeze([
  "help/settings/profile-edit",
  "help/settings/academic-year-create",
  "help/settings/academic-year-current",
  "help/settings/academic-periods-edit",
  "help/settings/grading-configuration-edit",
  "help/settings/pedagogical-structure-activate",
  "help/settings/school-courses-create",
  "help/settings/school-courses-edit",
  "help/settings/finance-fee-grid-create",
  "help/settings/finance-fee-grid-update",
]);

const SETTINGS_ARTICLE_IDS = Object.freeze([
  ...SETTINGS_READ_ARTICLE_IDS,
  ...SETTINGS_WRITE_ARTICLE_IDS,
  "help/users/assign-role",
]);

function articleBlob(article) {
  return `${article.title}\n${article.summary}\n${article.steps.join("\n")}`;
}

function catalogBlob() {
  return HELP_CATALOG.map((article) => `${article.id}\n${articleBlob(article)}`).join("\n\n");
}

function schoolAdmin(overrides = {}) {
  return createHelpContext({
    platform: HELP_PLATFORM.WEB,
    role: "Admin School",
    pathname: "/parametres",
    permissions: [
      "Paramètres Établissement:READ",
      "Paramètres Établissement:UPDATE",
      "Années Académiques:READ",
      "Années Académiques:CREATE",
      "Années Académiques:UPDATE",
      "Frais & tarifs:READ",
      "Frais & tarifs:CREATE",
      "Frais & tarifs:UPDATE",
      "Matières:CREATE",
      "Matières:UPDATE",
      "Utilisateurs:READ",
      "Utilisateurs:CREATE",
      "Utilisateurs:UPDATE",
      "Classes:READ",
      "Classes:CREATE",
    ],
    ...overrides,
  });
}

test("exposes the SETTINGS-01 help articles with expected titles", () => {
  for (const id of SETTINGS_ARTICLE_IDS) {
    const article = HELP_CATALOG.find((item) => item.id === id);
    assert.ok(article, id);
  }
  assert.equal(
    HELP_CATALOG.find((item) => item.id === "help/settings/profile").title,
    "Consulter le profil de l’établissement",
  );
  assert.equal(
    HELP_CATALOG.find((item) => item.id === "help/settings/academic-year").title,
    "Comprendre l’année scolaire",
  );
  assert.equal(
    HELP_CATALOG.find((item) => item.id === "help/settings/roles-permissions").title,
    "Comprendre les rôles et les droits",
  );
});

test("Admin School with Paramètres READ sees authorized settings articles", () => {
  const ids = filterHelpArticles(schoolAdmin()).map((article) => article.id);
  assert.equal(ids.includes("help/settings/overview"), true);
  assert.equal(ids.includes("help/settings/profile"), true);
  assert.equal(ids.includes("help/settings/academic-year"), true);
  assert.equal(ids.includes("help/settings/roles-permissions"), true);
  assert.equal(ids.includes("help/settings/coming-soon"), true);
  assert.equal(ids.includes("help/settings/profile-edit"), true);
});

test("Admin School with Paramètres READ without UPDATE sees profile consult, not edit", () => {
  const context = schoolAdmin({
    pathname: "/parametres/profil",
    permissions: ["Paramètres Établissement:READ", "Années Académiques:READ", "Frais & tarifs:READ"],
  });
  const ids = filterHelpArticles(context).map((article) => article.id);
  assert.equal(ids.includes("help/settings/profile"), true);
  assert.equal(ids.includes("help/settings/profile-edit"), false);
  const profile = HELP_CATALOG.find((item) => item.id === "help/settings/profile");
  assert.match(profile.title, /Consulter le profil/);
  assert.doesNotMatch(articleBlob(profile), /Enregistrer/);
  assert.doesNotMatch(articleBlob(profile), /vous pouvez modifier/);
  const searchHits = searchHelpArticles(context, "enregistrer modifier profil");
  assert.equal(
    searchHits.some((article) => article.id === "help/settings/profile-edit"),
    false,
  );
});

test("Années Académiques READ without CREATE does not see create-year procedure", () => {
  const context = schoolAdmin({
    pathname: "/parametres/annee-scolaire",
    permissions: ["Paramètres Établissement:READ", "Années Académiques:READ"],
  });
  const ids = filterHelpArticles(context).map((article) => article.id);
  assert.equal(ids.includes("help/settings/academic-year"), true);
  assert.equal(ids.includes("help/settings/academic-year-create"), false);
  assert.equal(ids.includes("help/settings/academic-year-current"), false);
  assert.equal(ids.includes("help/settings/academic-periods-edit"), false);
  assert.equal(ids.includes("help/settings/grading-configuration-edit"), false);
  const blob = articleBlob(HELP_CATALOG.find((item) => item.id === "help/settings/academic-year"));
  assert.doesNotMatch(blob, /Créer l’année/);
  assert.doesNotMatch(blob, /Définir comme courante/);
});

test("Frais & tarifs READ without CREATE/UPDATE has no fee-grid write procedure", () => {
  const context = schoolAdmin({
    pathname: "/parametres/finances",
    permissions: ["Paramètres Établissement:READ", "Frais & tarifs:READ"],
  });
  const ids = filterHelpArticles(context).map((article) => article.id);
  assert.equal(ids.includes("help/settings/finance"), true);
  assert.equal(ids.includes("help/settings/finance-fee-grid-create"), false);
  assert.equal(ids.includes("help/settings/finance-fee-grid-update"), false);
  const blob = articleBlob(HELP_CATALOG.find((item) => item.id === "help/settings/finance"));
  assert.doesNotMatch(blob, /Enregistrer le type de frais/);
  assert.doesNotMatch(blob, /créez une grille/i);
  const searchHits = searchHelpArticles(context, "créer grille tarifaire");
  assert.equal(
    searchHits.some((article) => article.id === "help/settings/finance-fee-grid-create"),
    false,
  );
});

test("Structure READ without UPDATE/Matières write sees consult, not activate or course CRUD", () => {
  const context = schoolAdmin({
    pathname: "/parametres/structure",
    permissions: ["Paramètres Établissement:READ"],
  });
  const ids = filterHelpArticles(context).map((article) => article.id);
  assert.equal(ids.includes("help/settings/pedagogical-structure"), true);
  assert.equal(ids.includes("help/settings/pedagogical-structure-activate"), false);
  assert.equal(ids.includes("help/settings/school-courses-create"), false);
  assert.equal(ids.includes("help/settings/school-courses-edit"), false);
  const blob = articleBlob(HELP_CATALOG.find((item) => item.id === "help/settings/pedagogical-structure"));
  assert.doesNotMatch(blob, /Activez uniquement/);
  assert.doesNotMatch(blob, /Créer un cours/);
});

test("Barème READ without UPDATE has no configure procedure", () => {
  const context = schoolAdmin({
    pathname: "/parametres/annee-scolaire",
    permissions: ["Paramètres Établissement:READ", "Années Académiques:READ"],
  });
  const ids = filterHelpArticles(context).map((article) => article.id);
  assert.equal(ids.includes("help/settings/grading-configuration"), true);
  assert.equal(ids.includes("help/settings/grading-configuration-edit"), false);
  const blob = articleBlob(HELP_CATALOG.find((item) => item.id === "help/settings/grading-configuration"));
  assert.doesNotMatch(blob, /Configurez/);
  assert.doesNotMatch(blob, /Modifiez les types/);
});

test("READ settings articles never embed WRITE procedures", () => {
  const writeProcedure = /Enregistrer|Créer l’année|Définir comme courante|Renseignez|Choisissez le mode|Configurez les types|Activez uniquement|créez une grille|vous pouvez modifier/i;
  for (const id of SETTINGS_READ_ARTICLE_IDS) {
    const article = HELP_CATALOG.find((item) => item.id === id);
    const writeTokens = article.permissions.filter((token) => /:(CREATE|UPDATE|DELETE)$/.test(token));
    assert.deepEqual(writeTokens, [], id);
    assert.doesNotMatch(articleBlob(article), writeProcedure, id);
  }
});

test("WRITE settings articles require CREATE or UPDATE", () => {
  for (const id of SETTINGS_WRITE_ARTICLE_IDS) {
    const article = HELP_CATALOG.find((item) => item.id === id);
    assert.ok(
      article.permissions.some((token) => /:(CREATE|UPDATE)$/.test(token)),
      id,
    );
    assert.equal(
      article.permissions.some((token) => /:READ$/.test(token)),
      false,
      id,
    );
  }
});

test("WRITE settings articles carry the extracted action procedures", () => {
  const expected = {
    "help/settings/profile-edit": /Enregistrez/,
    "help/settings/academic-year-create": /Créer l’année/,
    "help/settings/academic-year-current": /Définir comme courante/,
    "help/settings/academic-periods-edit": /Choisissez le mode/,
    "help/settings/grading-configuration-edit": /barème par défaut/,
    "help/settings/pedagogical-structure-activate": /Activez uniquement/,
    "help/settings/school-courses-create": /création est visible/,
    "help/settings/school-courses-edit": /modification est visible/,
    "help/settings/finance-fee-grid-create": /Enregistrer le type de frais/,
    "help/settings/finance-fee-grid-update": /moyens? de paiement/,
  };
  for (const [id, pattern] of Object.entries(expected)) {
    const article = HELP_CATALOG.find((item) => item.id === id);
    assert.match(articleBlob(article), pattern, id);
  }
});

test("user without Paramètres READ does not see settings catalog articles", () => {
  const ids = filterHelpArticles(
    schoolAdmin({
      permissions: ["Utilisateurs:READ", "Utilisateurs:CREATE", "Classes:READ"],
    }),
  ).map((article) => article.id);
  assert.equal(ids.includes("help/settings/overview"), false);
  assert.equal(ids.includes("help/settings/profile"), false);
  assert.equal(ids.includes("help/settings/roles-permissions"), false);
  assert.equal(ids.includes("help/users/create"), true);
});

test("teacher never sees establishment settings procedures", () => {
  const context = createHelpContext({
    platform: HELP_PLATFORM.WEB,
    role: "Enseignant",
    pathname: "/parametres",
    permissions: ["Paramètres Établissement:READ", "Paramètres Établissement:UPDATE", "Notes:READ"],
  });
  const ids = filterHelpArticles(context).map((article) => article.id);
  assert.equal(ids.some((id) => id.startsWith("help/settings/")), false);
});

test("maps Web Paramètres paths and Mobile settings routes to distinct screens", () => {
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/parametres" }), HELP_SCREEN.SETTINGS);
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/parametres/profil" }), HELP_SCREEN.SETTINGS_PROFILE);
  assert.equal(
    resolveHelpScreen({ platform: "web", pathname: "/parametres/annee-scolaire" }),
    HELP_SCREEN.SETTINGS_ACADEMIC_YEAR,
  );
  assert.equal(
    resolveHelpScreen({ platform: "web", pathname: "/parametres/structure" }),
    HELP_SCREEN.SETTINGS_STRUCTURE,
  );
  assert.equal(
    resolveHelpScreen({ platform: "web", pathname: "/parametres/roles-droits" }),
    HELP_SCREEN.SETTINGS_ROLES,
  );
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/parametres/finances" }), HELP_SCREEN.SETTINGS_FINANCE);
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/parametres/donnees" }), HELP_SCREEN.SETTINGS_DATA);
  assert.equal(resolveHelpScreen({ platform: "web", pathname: "/parametres/securite" }), HELP_SCREEN.SETTINGS_SECURITY);
  assert.equal(
    resolveHelpScreen({ platform: "web", pathname: "/parametres/mon-abonnement" }),
    HELP_SCREEN.SETTINGS_SUBSCRIPTION,
  );
  assert.equal(
    resolveHelpScreen({ platform: "web", pathname: "/parametres/notifications" }),
    HELP_SCREEN.SETTINGS_COMING_SOON,
  );
  assert.equal(
    resolveHelpScreen({ platform: "mobile", routeName: "Accueil" }),
    HELP_SCREEN.DASHBOARD,
  );
  assert.equal(
    resolveHelpScreen({ platform: "mobile", routeName: "EstablishmentProfile" }),
    HELP_SCREEN.SETTINGS_PROFILE,
  );
  assert.equal(
    resolveHelpScreen({ platform: "mobile", routeName: "SchoolYearSettings" }),
    HELP_SCREEN.SETTINGS_ACADEMIC_YEAR,
  );
  assert.equal(
    resolveHelpScreen({ platform: "mobile", routeName: "SchoolAssignableRoles" }),
    HELP_SCREEN.SETTINGS_ROLES,
  );
});

test("suggests contextual settings articles on the current screen", () => {
  const hub = suggestHelpArticles(schoolAdmin({ pathname: "/parametres" }));
  assert.ok(hub.some((article) => article.id === "help/settings/overview"));

  const year = suggestHelpArticles(schoolAdmin({ pathname: "/parametres/annee-scolaire" }));
  const yearIds = year.map((article) => article.id);
  assert.ok(yearIds.includes("help/settings/academic-year"));
  assert.ok(yearIds.includes("help/settings/academic-periods"));
  assert.ok(yearIds.includes("help/settings/grading-configuration"));

  const profile = suggestHelpArticles(schoolAdmin({ pathname: "/parametres/profil" }));
  assert.ok(profile.some((article) => article.id === "help/settings/profile"));
});

test("academic year article states it is a prerequisite for creating classes", () => {
  const article = HELP_CATALOG.find((item) => item.id === "help/settings/academic-year");
  const blob = articleBlob(article);
  assert.match(blob, /avant de pouvoir créer les classes/i);
  assert.match(blob, /Web et (sur )?Mobile/i);
  const overview = articleBlob(HELP_CATALOG.find((item) => item.id === "help/settings/overview"));
  assert.doesNotMatch(overview, /peut rester nécessaire sur le Web/);
});

test("school user create is identity then assign role, never role-during-create", () => {
  const create = HELP_CATALOG.find((item) => item.id === "help/users/create");
  const blob = articleBlob(create);
  assert.match(blob, /aucun rôle n’est attribué pendant cette création/);
  assert.match(blob, /Attribuer/);
  assert.doesNotMatch(blob, /Choisissez uniquement un rôle que votre propre compte est autorisé à attribuer/);
  assert.doesNotMatch(blob, /Choisissez un rôle pendant la création/);
  assert.ok(create.relatedArticles.includes("help/users/assign-role"));
});

test("roles article is lecture seule and never a school WRITE matrix procedure", () => {
  const article = HELP_CATALOG.find((item) => item.id === "help/settings/roles-permissions");
  const blob = articleBlob(article);
  assert.match(blob, /lecture seule|ne modifie pas la matrice/i);
  assert.doesNotMatch(blob, /modifiez la matrice/i);
  assert.doesNotMatch(blob, /créez un rôle/i);
  assert.equal(article.permissions.includes("Paramètres Établissement:UPDATE"), false);
  assert.ok(article.steps.some((step) => /Comptes utilisateurs → Attribuer/.test(step)));
});

test("finance does not present penalties as operational", () => {
  const article = HELP_CATALOG.find((item) => item.id === "help/settings/finance");
  const blob = articleBlob(article);
  assert.match(blob, /Paramètres → Finances/);
  assert.match(blob, /Finances → Paiements/);
  assert.match(blob, /pénalités de retard automatiques[\s\S]*ne sont pas disponibles/);
  assert.doesNotMatch(blob, /configurez les pénalités/i);
});

test("data export states restore is unavailable", () => {
  const article = HELP_CATALOG.find((item) => item.id === "help/settings/data-export");
  const blob = articleBlob(article);
  assert.match(blob, /Export : OUI/);
  assert.match(blob, /Sauvegarde\/restauration complète : NON/);
  assert.match(blob, /Restore : NON/);
  assert.match(blob, /Rollback : NON/);
  assert.doesNotMatch(blob, /cliquez sur Restaurer/);
});

test("subscription does not present offer change or cancellation as a guaranteed success", () => {
  const article = HELP_CATALOG.find((item) => item.id === "help/settings/subscription");
  const blob = articleBlob(article);
  assert.match(blob, /Consultez l’offre actuelle/);
  assert.match(blob, /n’est pas persisté/);
  assert.doesNotMatch(blob, /enregistrez le changement d’offre/i);
  assert.doesNotMatch(blob, /confirmez la résiliation/i);
});

test("coming-soon cards are described as not yet available", () => {
  const article = HELP_CATALOG.find((item) => item.id === "help/settings/coming-soon");
  const blob = articleBlob(article);
  assert.match(blob, /Cette fonctionnalité n’est pas encore disponible/);
  assert.match(blob, /Notifications/);
  assert.match(blob, /Apparence/);
  assert.match(blob, /Intégrations/);
  assert.doesNotMatch(blob, /configurez les canaux/i);
});

test("security is lecture seule and lists policies that cannot be edited", () => {
  const blob = articleBlob(HELP_CATALOG.find((item) => item.id === "help/settings/security"));
  assert.match(blob, /lecture seule/);
  assert.match(blob, /MFA/);
  assert.match(blob, /lockout/);
});

test("profile states code, country and city are immutable for the school admin", () => {
  const blob = articleBlob(HELP_CATALOG.find((item) => item.id === "help/settings/profile"));
  assert.match(blob, /code établissement n’est pas modifiable/i);
  assert.match(blob, /pays et la ville sont affichés en lecture seule/i);
  assert.match(blob, /URL publique/);
});

test("structure sends class creation to Mon établissement → Classes", () => {
  const blob = articleBlob(HELP_CATALOG.find((item) => item.id === "help/settings/pedagogical-structure"));
  assert.match(blob, /Mon établissement → Classes/);
  assert.match(blob, /ne crée pas librement un niveau/);
});

test("Notes teacher write procedures remain absent", () => {
  const ids = HELP_CATALOG.map((article) => article.id);
  assert.equal(ids.includes("help/grades/create-evaluation"), false);
  assert.equal(ids.includes("help/grades/enter"), false);
  const grading = articleBlob(HELP_CATALOG.find((item) => item.id === "help/settings/grading-configuration"));
  assert.match(grading, /ne publie pas de procédure pour créer une évaluation enseignant/);
});

test("settings search stays RBAC-filtered", () => {
  const hits = searchHelpArticles(schoolAdmin(), "année scolaire");
  assert.ok(hits.some((article) => article.id === "help/settings/academic-year"));
  const teacherHits = searchHelpArticles(
    createHelpContext({
      platform: HELP_PLATFORM.WEB,
      role: "Enseignant",
      pathname: "/notes",
      permissions: ["Notes:READ", "Paramètres Établissement:READ"],
    }),
    "année scolaire",
  );
  assert.equal(
    teacherHits.some((article) => article.id.startsWith("help/settings/")),
    false,
  );
});

test("catalog never documents restore, penalty config, or school RBAC matrix write", () => {
  const blob = catalogBlob();
  assert.doesNotMatch(blob, /help\/grades\/create-evaluation/);
  assert.doesNotMatch(blob, /help\/grades\/enter/);
  assert.doesNotMatch(blob, /sauvegarde complète de l’établissement est disponible/i);
  assert.doesNotMatch(blob, /Restaurez la sauvegarde/i);
});
