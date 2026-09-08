"use strict";

/**
 * PR F GREEN — contrats de consolidation (06A / 06B / 06C / 06E).
 * Familles C3 et platform_announcements restent séparées (pas de 06D/06F).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("RED-COM-06A — un événement opérationnel ne doit plus avoir deux destinations notifications", () => {
  const workflow = read("web/src/pages/entity-page/paymentWorkflow.ts");
  const c4 = read("backend/lib/communicationsNotificationsService.js");
  assert.match(
    c4,
    /eventType === "finance\.payment\.recorded"/,
    "C4 doit rester la persistance canonique de finance.payment.recorded",
  );
  assert.doesNotMatch(
    workflow,
    /notifications:\s*notification/,
    "paymentWorkflow injecte encore une PlatformNotification dans state.notifications alors que C4 persiste déjà finance.payment.recorded",
  );
  assert.doesNotMatch(
    read("web/src/lib/quickPayment.ts"),
    /export function buildParentPaymentNotification/,
    "buildParentPaymentNotification alimente encore le dataset legacy au lieu du contrat C4",
  );
});

test("RED-COM-06B — Web établissement ne doit plus lire le catalogue legacy pour l'inbox C4", () => {
  const page = read("web/src/pages/NotificationsPage.tsx");
  const kpi = read("web/src/lib/scope.ts").slice(
    read("web/src/lib/scope.ts").indexOf("export function getLiveKpis"),
  );

  assert.match(page, /InternalNotificationsCenter/);
  assert.doesNotMatch(
    page,
    /platformApi/,
    "la même route Web /notifications sert encore le CRUD legacy /backoffice/notifications à côté du centre C4",
  );
  assert.doesNotMatch(
    kpi,
    /notifications\.filter\(\(n\) => n\.status === "Non lu"\)/,
    "getLiveKpis établissement lit encore state.notifications (legacy) alors que C4 contient les alertes opérationnelles",
  );
});

test("RED-COM-06C — Mobile ne doit plus préférer le catalogue legacy au centre C4", () => {
  const home = read("Mobile/src/screens/HomeScreen.tsx");
  const start = home.indexOf("platformNotifications:");
  assert.ok(start >= 0, "CTA Home notifications introuvable");
  const block = home.slice(start, home.indexOf("announcements:", start));
  const internalFirst =
    block.indexOf('navigate("InternalNotifications")') >= 0 &&
    (block.indexOf('navigate("PlatformNotifications")') < 0 ||
      block.indexOf('navigate("InternalNotifications")') < block.indexOf('navigate("PlatformNotifications")'));
  assert.equal(
    internalFirst,
    true,
    "HomeScreen route encore le CTA Notifications vers PlatformNotifications (table notifications) dès que le privilège plateforme est présent, même si InternalNotifications (C4) est lisible",
  );
});

test("RED-COM-06E — unread établissement : KPI et badge doivent partager la source C4", () => {
  const topbar = read("web/src/components/layout/Topbar.tsx");
  const kpi = read("web/src/lib/scope.ts").slice(
    read("web/src/lib/scope.ts").indexOf("export function getLiveKpis"),
  );

  assert.match(topbar, /useInternalNotificationsUnreadCount/);
  assert.match(topbar, /hasInternalNotificationScope/);
  assert.doesNotMatch(
    kpi,
    /notifications\.filter\(\(n\) => n\.status === "Non lu"\)/,
    "KPI Alertes à traiter compte encore les unread legacy (status Non lu) : divergence possible avec GET /internal-notifications/unread-count",
  );
});
