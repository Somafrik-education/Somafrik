"use strict";

/**
 * HELP-SETTINGS-02 — Gate catalogue Paramètres aligné sur SETTINGS-01.
 * Utilise settings-functional-matrix.json comme garde-fou.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");

function readRepo(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const CARD_ARTICLES = {
  profil: ["help/settings/profile", "help/settings/profile-edit"],
  "annee-scolaire": [
    "help/settings/academic-year",
    "help/settings/academic-year-create",
    "help/settings/academic-year-current",
    "help/settings/academic-periods",
    "help/settings/academic-periods-edit",
    "help/settings/grading-configuration",
    "help/settings/grading-configuration-edit",
  ],
  structure: [
    "help/settings/pedagogical-structure",
    "help/settings/pedagogical-structure-activate",
    "help/settings/school-courses-create",
    "help/settings/school-courses-edit",
  ],
  "roles-droits": ["help/settings/roles-permissions"],
  finances: [
    "help/settings/finance",
    "help/settings/finance-fee-grid-create",
    "help/settings/finance-fee-grid-update",
  ],
  donnees: ["help/settings/data-export"],
  securite: ["help/settings/security"],
  "mon-abonnement": ["help/settings/subscription"],
  notifications: ["help/settings/coming-soon"],
  apparence: ["help/settings/coming-soon"],
  integrations: ["help/settings/coming-soon"],
};

const REQUIRED_IDS = [
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
  "help/users/assign-role",
  "help/users/create",
];

const FORBIDDEN_IDS = [
  "help/grades/create-evaluation",
  "help/grades/enter",
  "help/settings/restore",
  "help/settings/penalties",
  "help/settings/notifications-config",
  "help/settings/appearance-config",
  "help/settings/integrations-config",
  "help/settings/documents-receipts",
];

function articleText(article) {
  return `${article.title}\n${article.summary}\n${(article.steps || []).join("\n")}`;
}

async function loadCatalog() {
  const mod = await import(pathToFileURL(path.join(ROOT, "packages/help-catalog/src/index.js")).href);
  return mod.HELP_CATALOG;
}

function runPackageTests() {
  const result = spawnSync(process.execPath, ["--test"], {
    cwd: path.join(ROOT, "packages/help-catalog"),
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, "packages/help-catalog tests ont échoué");
}

async function main() {
  const matrix = JSON.parse(readRepo("docs/audits/settings-functional-matrix.json"));
  const catalog = await loadCatalog();
  const byId = Object.fromEntries(catalog.map((article) => [article.id, article]));
  const blob = catalog.map((article) => `${article.id}\n${articleText(article)}`).join("\n\n");

  for (const id of REQUIRED_IDS) {
    assert.ok(byId[id], `article manquant : ${id}`);
  }
  for (const id of FORBIDDEN_IDS) {
    assert.equal(Boolean(byId[id]), false, `article interdit présent : ${id}`);
  }

  assert.equal(matrix.notesTeacherP1, "present");
  assert.equal(matrix.restoreAvailable, false);
  assert.equal(matrix.penaltiesOperational, false);
  assert.equal(matrix.rolesSchoolStatus, "LECTURE_SEULE");

  for (const card of matrix.cards) {
    if (card.status === "BIENTOT" || (card.verdict || []).includes("FUTURE")) {
      const comingSoon = articleText(byId["help/settings/coming-soon"]);
      assert.match(comingSoon, /Cette fonctionnalité n’est pas encore disponible/);
      assert.match(comingSoon, new RegExp(card.title.split(" ")[0], "i"));
      assert.equal(card.helpWriteEligible, false);
    }

    const mapped = CARD_ARTICLES[card.id] || [];
    if (card.helpWriteEligible === false && mapped.length) {
      for (const articleId of mapped) {
        const article = byId[articleId];
        const text = articleText(article);
        if (card.id === "roles-droits") {
          assert.match(text, /ne modifie pas la matrice/i);
          assert.doesNotMatch(text, /modifiez la matrice CRUD/i);
        }
        if (card.id === "donnees") {
          assert.match(text, /Restore : NON/);
          assert.doesNotMatch(text, /procédure de restauration complète/i);
        }
        if (card.id === "mon-abonnement") {
          assert.match(text, /n’est pas persisté/);
        }
        if (card.id === "securite") {
          assert.match(text, /lecture seule/i);
        }
        if (["notifications", "apparence", "integrations"].includes(card.id)) {
          assert.equal(articleId, "help/settings/coming-soon");
        }
        assert.doesNotMatch(text, /opération réussie garantie/i);
      }
    }

    if (card.helpEligible === false && card.scope === "platform") {
      assert.ok(
        !catalog.some((article) => article.id === `help/settings/${card.id}` && /configurer/i.test(article.title)),
        `pas d'article WRITE école pour la carte plateforme ${card.id}`,
      );
    }
  }

  const finance = articleText(byId["help/settings/finance"]);
  assert.match(finance, /pénalités de retard automatiques[\s\S]*ne sont pas disponibles/);
  assert.doesNotMatch(finance, /activez les pénalités/i);

  const year = articleText(byId["help/settings/academic-year"]);
  assert.match(year, /avant de pouvoir créer les classes/);

  const writePermissions = {
    "help/settings/profile-edit": "Paramètres Établissement:UPDATE",
    "help/settings/academic-year-create": "Années Académiques:CREATE",
    "help/settings/academic-year-current": "Années Académiques:UPDATE",
    "help/settings/academic-periods-edit": "Paramètres Établissement:UPDATE",
    "help/settings/grading-configuration-edit": "Paramètres Établissement:UPDATE",
    "help/settings/pedagogical-structure-activate": "Paramètres Établissement:UPDATE",
    "help/settings/school-courses-create": "Matières:CREATE",
    "help/settings/school-courses-edit": "Matières:UPDATE",
    "help/settings/finance-fee-grid-create": "Frais & tarifs:CREATE",
    "help/settings/finance-fee-grid-update": "Frais & tarifs:UPDATE",
  };
  for (const [id, permission] of Object.entries(writePermissions)) {
    const article = byId[id];
    assert.ok(article.permissions.includes(permission), `${id} doit exiger ${permission}`);
    assert.equal(
      article.permissions.some((token) => /:READ$/.test(token)),
      false,
      `${id} ne doit pas être filtré par READ`,
    );
  }

  const readOnlyIds = [
    "help/settings/profile",
    "help/settings/academic-year",
    "help/settings/academic-periods",
    "help/settings/grading-configuration",
    "help/settings/pedagogical-structure",
    "help/settings/finance",
  ];
  const leakedWritePhrases = [
    "Enregistrez",
    "Créer l’année",
    "Créer l'année",
    "Définir comme courante",
    "Choisissez le mode",
    "Renseignez les dates",
    "Configurez le barème",
    "Configurez les types",
    "Activez uniquement",
    "Enregistrer le type de frais",
  ];
  for (const id of readOnlyIds) {
    const article = byId[id];
    assert.equal(
      article.permissions.some((token) => /:(CREATE|UPDATE|DELETE)$/.test(token)),
      false,
      `${id} doit rester READ-only`,
    );
    const text = articleText(article);
    for (const phrase of leakedWritePhrases) {
      assert.equal(text.includes(phrase), false, `${id} (READ) ne doit pas exposer « ${phrase} »`);
    }
  }

  const createUser = articleText(byId["help/users/create"]);
  assert.match(createUser, /aucun rôle n’est attribué pendant cette création/);
  assert.match(createUser, /Attribuer/);
  assert.doesNotMatch(createUser, /Choisissez un rôle pendant la création/);

  assert.doesNotMatch(blob, /help\/grades\/create-evaluation/);
  assert.doesNotMatch(blob, /help\/grades\/enter/);
  assert.doesNotMatch(readRepo("packages/help-catalog/src/articles.js"), /Créer une évaluation enseignant/);
  assert.doesNotMatch(readRepo("docs/user-guides/KNOWN-ISSUES.md"), /P1 corrigé/);
  assert.match(readRepo("docs/user-guides/KNOWN-ISSUES.md"), /## 18\. Notes enseignant/);

  const screens = readRepo("packages/help-catalog/src/screens.js");
  assert.match(screens, /SETTINGS_PROFILE/);
  assert.match(screens, /\/parametres\/profil/);
  assert.match(screens, /EstablishmentProfile: HELP_SCREEN.SETTINGS_PROFILE/);

  runPackageTests();
  console.log("verify-help-settings: GO");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
