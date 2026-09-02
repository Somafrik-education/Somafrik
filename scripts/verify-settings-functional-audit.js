"use strict";

/**
 * SETTINGS-01 — Gate d'audit fonctionnel Paramètres.
 * Rapide : parse le hub, les routes, le JSON d'audit. Pas d'HTTP, pas de PG.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function readRepo(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function extractSettingCards(hubSource) {
  const cards = [];
  const block = hubSource.match(/const SETTING_CARDS: SettingCard\[\] = \[([\s\S]*?)\];/);
  assert.ok(block, "SETTING_CARDS introuvable dans SettingsHubPage.tsx");
  const re =
    /to:\s*"(?<to>\/parametres\/[^"]+)"[\s\S]*?title:\s*"(?<title>[^"]+)"[\s\S]*?status:\s*"(?<status>available|soon)"/g;
  let match;
  while ((match = re.exec(block[1]))) {
    cards.push({
      to: match.groups.to,
      title: match.groups.title,
      status: match.groups.status,
    });
  }
  assert.ok(cards.length >= 14, `attendu ≥ 14 cartes hub, obtenu ${cards.length}`);
  return cards;
}

function extractParametresBlock(appSource) {
  const parametresBlock = appSource.match(/path="\/parametres"[\s\S]*?\{\/\* Anciennes URLs paramètres/);
  assert.ok(parametresBlock, "bloc /parametres introuvable dans App.tsx");
  return parametresBlock[0];
}

function main() {
  const hubSource = readRepo("web/src/pages/parametres/SettingsHubPage.tsx");
  const appSource = readRepo("web/src/App.tsx");
  const placeholders = readRepo("web/src/pages/parametres/SettingsPlaceholders.tsx");
  const financePage = readRepo("web/src/pages/parametres/SettingsFinancePage.tsx");
  const dataPage = readRepo("web/src/pages/parametres/DataBackupSettingsPage.tsx");
  const configPage = readRepo("web/src/pages/ConfigurationPage.tsx");
  const knownIssues = readRepo("docs/user-guides/KNOWN-ISSUES.md");
  const permissions = readRepo("web/src/lib/permissions.ts");
  const matrix = JSON.parse(readRepo("docs/audits/settings-functional-matrix.json"));
  const auditMd = readRepo("docs/audits/settings-functional-audit.md");

  assert.equal(matrix.auditId, "SETTINGS-01");
  assert.match(matrix.developSha, /^[0-9a-f]{40}$/);

  const hubCards = extractSettingCards(hubSource);
  const matrixByRoute = new Map(matrix.cards.map((card) => [card.route, card]));

  // 1–2. Toutes les cartes hub dans la matrice ; aucune oubliée / extra hub.
  for (const hub of hubCards) {
    const card = matrixByRoute.get(hub.to);
    assert.ok(card, `carte hub absente de la matrice : ${hub.to}`);
    assert.equal(card.title, hub.title, `titre divergént pour ${hub.to}`);
    assert.equal(card.hubStatus, hub.status, `hubStatus JSON ≠ SETTING_CARDS pour ${hub.to}`);
  }
  const hubRoutes = new Set(hubCards.map((card) => card.to));
  for (const card of matrix.cards) {
    assert.ok(hubRoutes.has(card.route), `carte matrice hors hub : ${card.route}`);
  }
  assert.equal(matrix.cards.length, hubCards.length);

  // 3. Carte hub soon → BIENTOT
  for (const hub of hubCards.filter((card) => card.status === "soon")) {
    assert.equal(matrixByRoute.get(hub.to).status, "BIENTOT", `${hub.to} soon doit être BIENTOT`);
  }

  // 4–6. Notifications / Apparence / Intégrations = BIENTOT
  for (const id of ["notifications", "apparence", "integrations"]) {
    const card = matrix.cards.find((item) => item.id === id);
    assert.ok(card, `carte ${id} manquante`);
    assert.equal(card.status, "BIENTOT");
    assert.equal(card.verdict.includes("FUTURE") || card.verdict.every((v) => v === "FUTURE"), true);
    assert.equal(card.helpWriteEligible, false);
  }
  assert.match(placeholders, /function SettingsNotificationsPage/);
  assert.match(placeholders, /function SettingsAppearancePage/);
  assert.match(placeholders, /function SettingsIntegrationsPage/);
  assert.equal([...placeholders.matchAll(/ComingSoonState/g)].length >= 3, true);

  // 7–8. Rôles établissement lecture seule ; Superadmin configurable
  const roles = matrix.cards.find((card) => card.id === "roles-droits");
  assert.equal(roles.status, "LECTURE_SEULE");
  assert.equal(roles.schoolAccess, "LECTURE_SEULE");
  assert.equal(roles.superadminConfigurable, true);
  assert.equal(matrix.rolesSchoolStatus, "LECTURE_SEULE");
  assert.equal(matrix.rolesSuperadminConfigurable, true);
  assert.match(configPage, /Droits accordés par le Super administrateur \(lecture seule\)/);
  assert.match(permissions, /export function canManageRolePermissions/);
  assert.match(permissions, /return isSuperAdminRole\(ctx\.user\?\.role\)/);
  assert.equal(roles.helpWriteEligible, false);
  assert.ok(roles.verdict.includes("GO_HELP_READ"));
  assert.ok(!roles.verdict.includes("GO_HELP_WRITE"));

  // 9. Finances ne prétend pas que les pénalités sont opérationnelles
  const finances = matrix.cards.find((card) => card.id === "finances");
  assert.equal(finances.penaltiesOperational, false);
  assert.equal(matrix.penaltiesOperational, false);
  assert.match(financePage, /Réductions et pénalités — différées V1/);
  assert.match(financePage, /Les pénalités de retard ne sont pas un référentiel/);
  assert.doesNotMatch(JSON.stringify(finances), /pénalités opérationnelles/i);

  // 10. Restore complet non déclaré disponible
  const dataCard = matrix.cards.find((card) => card.id === "donnees");
  assert.equal(dataCard.restoreAvailable, false);
  assert.equal(matrix.restoreAvailable, false);
  assert.equal(matrix.backupCompleteAvailable, false);
  assert.match(dataPage, /La restauration complète n/);
  assert.doesNotMatch(auditMd, /Restore disponible \?\s+Oui/);

  // 11. Planning classé ACTUEL_PARTIEL
  assert.equal(matrix.planningStatus, "ACTUEL_PARTIEL");
  const planning = matrix.relatedFlows.find((flow) => flow.id === "planning");
  assert.ok(planning);
  assert.equal(planning.status, "ACTUEL_PARTIEL");
  const roomsPlaceholder = readRepo("web/src/pages/planning/PlanningPlaceholders.tsx");
  assert.match(roomsPlaceholder, /ComingSoonState/);
  assert.match(roomsPlaceholder, /Emploi du temps par salle/);

  // 12. Notes P1 reflété
  assert.equal(matrix.notesTeacherP1, "present");
  assert.match(knownIssues, /## 18\. Notes enseignant/);
  assert.match(knownIssues, /GET \/api\/assignments/);
  assert.match(knownIssues, /write_notes/);
  const notesFlow = matrix.relatedFlows.find((flow) => flow.id === "notes");
  assert.equal(notesFlow.helpWriteEligible, false);
  const rbac = readRepo("backend/services/rbacService.js");
  assert.match(rbac, /"GET \/api\/assignments"/);
  const subscription = readRepo("backend/services/schoolSubscriptionAccessService.js");
  assert.match(subscription, /write_notes/);

  // 13. Aucune fonctionnalité future HELP write eligible
  for (const card of matrix.cards) {
    if (card.status === "BIENTOT" || (card.verdict && card.verdict.includes("FUTURE"))) {
      assert.equal(card.helpWriteEligible, false, `${card.id} future ne doit pas être HELP write`);
      assert.equal(card.helpEligible, false, `${card.id} BIENTOT ne doit pas être HELP eligible`);
    }
    if (card.status === "LECTURE_SEULE") {
      assert.equal(card.helpWriteEligible, false, `${card.id} lecture seule ≠ HELP write`);
    }
  }

  // 14. Toutes les routes Paramètres connues couvertes
  const parametresBlock = extractParametresBlock(appSource);
  const hubLeafPaths = hubCards.map((card) => card.to.replace("/parametres/", ""));
  for (const leaf of hubLeafPaths) {
    assert.match(parametresBlock, new RegExp(`path="${leaf}"`));
  }
  for (const nested of ["factures", "paiements", "changer-offre", "resiliation"]) {
    assert.match(parametresBlock, new RegExp(`path="${nested}"`));
  }
  for (const route of matrix.knownParametresRoutes) {
    const cardMatch = matrix.cards.some(
      (card) => card.route === route || route.startsWith(`${card.route}/`),
    );
    assert.ok(
      cardMatch || route === "/parametres",
      `route knownParametresRoutes non rattachée à une carte : ${route}`,
    );
  }

  assert.match(auditMd, /## 1\. Executive summary/);
  assert.match(auditMd, /## 2\. Matrice des cartes/);
  assert.match(auditMd, /## 3\. Parcours configuration établissement recommandé/);
  assert.match(auditMd, /## 4\. Matrice RBAC/);
  assert.match(auditMd, /## 5\. Web \/ Mobile/);
  assert.match(auditMd, /## 6\. Fonctions futures/);
  assert.match(auditMd, /## 7\. P0 \/ P1 \/ P2/);
  assert.match(auditMd, /## 8\. Écarts de libellé/);
  assert.match(auditMd, /## 9\. Parcours documentables HELP/);
  assert.match(auditMd, /## 10\. Parcours interdits HELP/);
  assert.match(auditMd, /P1 Notes enseignant : toujours présent/);

  console.log(`SETTINGS-01 audit gate OK — ${hubCards.length} cartes hub, SHA ${matrix.developSha.slice(0, 12)}`);
}

main();
