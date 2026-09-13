"use strict";

/**
 * AUDIT-COM-MODULE — inventaire GREEN.
 * Vérifie que le dossier d'audit est complet et que les contrats déjà
 * livrés (isolation, RBAC, SoT conversations) sont toujours présents.
 * Ces tests doivent passer sans correction fonctionnelle.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const REPORT = "docs/audits/communication-module-audit.md";
const MATRIX = "docs/audits/evidence/communication-module-audit-matrix.json";

function readRepo(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("le rapport d'audit Communication existe avec les sections obligatoires", () => {
  const report = readRepo(REPORT);
  assert.match(report, /# Audit module Communication/);
  assert.match(report, /## 1\. Gouvernance/);
  assert.match(report, /## 2\. Cartographie fonctionnelle/);
  assert.match(report, /## 3\. Matrice fonctionnelle/);
  assert.match(report, /## 4\. Anomalies FAIL\/PARTIAL/);
  assert.match(report, /## 5\. Tests existants/);
  assert.match(report, /## 6\. Zones sans couverture/);
  assert.match(report, /## 7\. Notifications/);
  assert.match(report, /## 8\. Lots de correction/);
  assert.match(report, /STOP/);
  assert.match(report, /Aucun merge sans diff GitHub indépendant CTO/);
});

test("la matrice JSON est alignée sur le markdown", () => {
  const matrix = JSON.parse(readRepo(MATRIX));
  const report = readRepo(REPORT);
  assert.equal(matrix.auditId, "AUDIT-COM-MODULE-2026-09-13");
  assert.equal(matrix.originBaseSha, "1bf4a057817cb009120042a9bb7b23ba211e2269");
  assert.equal(matrix.validationBaseSha, "a42c079d4a18b4a56277f1cd2f553329e416d3d1");
  assert.equal(matrix.auditBranch, "audit/communication-module");
  assert.match(report, /1bf4a057817cb009120042a9bb7b23ba211e2269/);
  assert.match(report, /a42c079d4a18b4a56277f1cd2f553329e416d3d1/);
  assert.match(report, /Base d'origine/);
  assert.match(report, /Base de validation/);
  assert.deepEqual(matrix.redTests, [
    "AUDIT-COM-RED-02",
    "AUDIT-COM-RED-03",
    "AUDIT-COM-RED-04",
    "AUDIT-COM-RED-05",
    "AUDIT-COM-RED-06",
  ]);
  assert.ok(Array.isArray(matrix.closedRedTests) && matrix.closedRedTests.length >= 1);
  const closed01 = matrix.closedRedTests.find((row) => row.id === "AUDIT-COM-RED-01");
  assert.ok(closed01, "AUDIT-COM-RED-01 doit être dans closedRedTests");
  assert.equal(closed01.status, "GREEN");
  assert.equal(closed01.pr, 628);
  assert.equal(closed01.mergeCommit, "a42c079d4a18b4a56277f1cd2f553329e416d3d1");
  assert.match(report, /AUDIT-COM-RED-01/);
  assert.match(report, /#628/);
  assert.ok(Array.isArray(matrix.features) && matrix.features.length >= 40);
  for (const feature of matrix.features) {
    assert.match(report, new RegExp(`\\| ${feature.id} \\|`), `ID ${feature.id} absent du markdown`);
    assert.match(report, new RegExp(`\\| ${feature.verdict} \\|`), `verdict ${feature.verdict} absent du markdown`);
    for (const verdict of [feature.web, feature.mobile, feature.api, feature.postgresql, feature.rbac, feature.tests, feature.verdict]) {
      assert.ok(
        matrix.verdictsAllowed.includes(verdict),
        `${feature.id}: verdict invalide ${verdict}`,
      );
    }
  }
  for (const redId of matrix.redTests) {
    assert.match(report, new RegExp(redId), `test RED ${redId} non documenté`);
  }
});

test("C2/C3/C4 : isolation school_id et RBAC toujours câblés", () => {
  const messages = readRepo("backend/lib/communicationsMessagesService.js");
  const announcements = readRepo("backend/lib/communicationsAnnouncementsService.js");
  const rbac = readRepo("backend/services/rbacService.js");
  const c2 = readRepo("backend/lib/communicationsC2.http.pg.test.js");
  const c3 = readRepo("backend/lib/communicationsC3.http.pg.test.js");
  const c4 = readRepo("backend/lib/communicationsC4.http.pg.test.js");

  assert.match(messages, /function canBypassParticipation\(\) \{\s*return false;/);
  assert.match(messages, /message\.school_id !== school\.id/);
  assert.match(messages, /ignoreClientScope/);
  assert.match(messages, /Message obligatoire/);
  assert.match(messages, /Destinataire obligatoire/);
  assert.match(announcements, /school_id/);
  assert.match(rbac, /GET \/api\/backoffice\/messages/);
  assert.match(rbac, /POST \/api\/backoffice\/announcements/);
  assert.match(rbac, /GET \/api\/backoffice\/internal-notifications/);
  assert.match(c2, /C2-02 Admin B/);
  assert.match(c2, /C2-12/);
  assert.match(c3, /C3-01 école B ne voit jamais/);
  assert.match(c4, /C4-02 école B isolée/);
});

test("Web et Mobile listent les conversations canoniques C2", () => {
  const webPage = readRepo("web/src/pages/MessagesConversationsPage.tsx");
  const webApi = readRepo("web/src/lib/messagesApi.ts");
  const mobileScreen = readRepo("Mobile/src/screens/MessagesScreen.tsx");
  const hydration = readRepo("Mobile/src/services/domainHydrationApi.ts");

  assert.match(webApi, /\/backoffice\/conversations/);
  assert.match(webPage, /listConversations/);
  assert.match(webPage, /messagesApi\.reply/);
  assert.match(`${mobileScreen}\n${hydration}`, /\/backoffice\/conversations/);
  assert.match(mobileScreen, /getCanonicalConversations/);
});

test("compteurs non lus = API unread-count, pas un décompte local de page", () => {
  const topbar = readRepo("web/src/components/layout/Topbar.tsx");
  const webMessages = readRepo("web/src/pages/MessagesConversationsPage.tsx");
  const mobileMessages = readRepo("Mobile/src/screens/MessagesScreen.tsx");
  const mobileHome = readRepo("Mobile/src/screens/HomeScreen.tsx");
  const mobileC4 = readRepo("Mobile/src/screens/InternalNotificationsScreen.tsx");

  assert.match(topbar, /unread-count|useMessagesUnreadCount|messagesApi\.unreadCount/);
  assert.match(webMessages, /unreadCount/);
  assert.match(mobileMessages, /useMessagesUnreadCount|getMessagesUnreadCount/);
  assert.match(mobileHome, /getMessagesUnreadCount|useMessagesUnreadCount/);
  assert.match(mobileC4, /getInternalNotificationsUnreadCount|useInternalNotificationsUnreadCount/);
});

test("chrome Communication et filtre client sont partagés Web / Mobile", () => {
  const webChrome = readRepo("web/src/components/communications/CommunicationChrome.tsx");
  const mobileChrome = readRepo("Mobile/src/components/CommunicationChrome.tsx");
  const webFilter = readRepo("web/src/lib/communicationListFilter.ts");
  const mobileFilter = readRepo("Mobile/src/lib/communicationListFilter.ts");
  const webMessages = readRepo("web/src/pages/MessagesConversationsPage.tsx");
  const mobileMessages = readRepo("Mobile/src/screens/MessagesScreen.tsx");

  assert.match(webChrome, /Communication/);
  assert.match(mobileChrome, /Communication/);
  assert.match(webFilter, /filterCommunicationRows/);
  assert.match(mobileFilter, /filterCommunicationRows/);
  assert.match(webMessages, /Rechercher/);
  assert.match(webMessages, /Non lus/);
  assert.match(mobileMessages, /Rechercher|COM_SEARCH_PLACEHOLDER/);
});

test("Web Notifications C4 expose Ouvrir/Lire câblé, pas un no-op", () => {
  const center = readRepo("web/src/components/communications/InternalNotificationsCenter.tsx");
  const nav = readRepo("web/src/lib/notificationNavigation.ts");
  assert.match(center, /Ouvrir|Lire/);
  assert.match(center, /openNotification|resolveNotificationDestination/);
  assert.match(nav, /conversation/);
  assert.match(nav, /announcement/);
  assert.match(nav, /conversationId/);
});

test("création message/annonce refuse le corps vide côté API", () => {
  const messages = readRepo("backend/lib/communicationsMessagesService.js");
  const announcements = readRepo("backend/lib/communicationsAnnouncementsService.js");
  const webMessages = readRepo("web/src/pages/MessagesConversationsPage.tsx");
  const webAnnouncements = readRepo("web/src/pages/AnnouncementsPage.tsx");
  const mobileMessages = readRepo("Mobile/src/screens/MessagesScreen.tsx");

  assert.match(messages, /Message obligatoire/);
  assert.match(webMessages, /Message est obligatoire/);
  assert.match(mobileMessages, /Message est obligatoire/);
  assert.match(webAnnouncements, /Titre obligatoire/);
  assert.match(webAnnouncements, /Contenu obligatoire/);
  assert.match(announcements, /title|Titre|message|obligatoire/i);
});

test("tests HTTP PostgreSQL C2/C3/C4 et parité Communication sont présents", () => {
  const required = [
    "backend/lib/communicationsC2.http.pg.test.js",
    "backend/lib/communicationsC3.http.pg.test.js",
    "backend/lib/communicationsC4.http.pg.test.js",
    "web/src/lib/pariteCommunication.red.ts",
    "Mobile/src/lib/pariteCommunication.red.test.ts",
    "web/src/lib/pariteCommunicationUx.test.ts",
    "Mobile/src/lib/pariteCommunicationUx.test.ts",
    "scripts/communication-module-audit.red.test.js",
  ];
  for (const relative of required) {
    assert.equal(fs.existsSync(path.join(ROOT, relative)), true, `manquant: ${relative}`);
  }
});
