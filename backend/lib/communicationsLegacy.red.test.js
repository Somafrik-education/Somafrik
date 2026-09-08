"use strict";

/**
 * Lot J / GREEN F — contrats de consolidation (J-01 / J-02 / J-03 / J-04).
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

test("J-01 / RED-COM-06A — finance.payment.recorded n'a plus de double write catalogue B", () => {
  const workflow = read("web/src/pages/entity-page/paymentWorkflow.ts");
  const c4 = read("backend/lib/communicationsNotificationsService.js");
  const paymentTx = read("backend/services/paymentTransactionService.js");
  assert.match(
    c4,
    /eventType === "finance\.payment\.recorded"/,
    "C4 doit rester la persistance canonique de finance.payment.recorded",
  );
  assert.doesNotMatch(
    workflow,
    /notifications:\s*notification/,
    "paymentWorkflow injecte encore une PlatformNotification dans state.notifications",
  );
  assert.doesNotMatch(
    read("web/src/lib/quickPayment.ts"),
    /export function buildParentPaymentNotification/,
    "buildParentPaymentNotification alimente encore le dataset legacy au lieu du contrat C4",
  );
  assert.doesNotMatch(paymentTx, /function buildParentNotification/);
  assert.doesNotMatch(
    paymentTx,
    /notifications:\s*\[notification/,
    "paymentTransactionService injecte encore state.notifications pour un paiement enregistré",
  );
});

test("J-01 runtime — applyAtomicPayment ne touche pas le catalogue plateforme", () => {
  const { applyAtomicPayment } = require("../services/paymentTransactionService");
  const existing = [{ id: "EXISTING-B", status: "Non lu", title: "Catalogue" }];
  const state = {
    students: [{ id: "stu-1", firstName: "A", lastName: "B", schoolCode: "SCH-1" }],
    schools: [{ code: "SCH-1", currency: "CDF" }],
    payments: [],
    studentFees: [],
    notifications: existing,
    auditLog: [],
  };
  const { nextState } = applyAtomicPayment(
    state,
    {
      studentId: "stu-1",
      feeType: "Scolarité",
      amount: 1000,
      method: "Espèces",
      date: "2026-09-08",
    },
    { firstName: "Admin", lastName: "School", sub: "u1", identifier: "admin" },
  );
  assert.equal(nextState.notifications, existing);
  assert.equal(nextState.notifications.length, 1);
  assert.equal(nextState.notifications[0].id, "EXISTING-B");
  assert.equal(nextState.payments.length, 1);
});

test("J-02 / RED-COM-06B — Web établissement ne lit plus le catalogue legacy pour l'inbox C4", () => {
  const page = read("web/src/pages/NotificationsPage.tsx");
  const app = read("web/src/App.tsx");
  const kpi = read("web/src/lib/scope.ts").slice(
    read("web/src/lib/scope.ts").indexOf("export function getLiveKpis"),
  );

  assert.match(page, /InternalNotificationsCenter/);
  assert.doesNotMatch(
    page,
    /platformApi/,
    "la même route Web /notifications sert encore le CRUD legacy /backoffice/notifications à côté du centre C4",
  );
  assert.match(app, /path="\/notifications"/);
  assert.match(app, /path="\/notifications-plateforme"/);
  assert.doesNotMatch(
    kpi,
    /notifications\.filter\(\(n\) => n\.status === "Non lu"\)/,
    "getLiveKpis établissement lit encore state.notifications (legacy) alors que C4 contient les alertes opérationnelles",
  );
});

test("J-03 / RED-COM-06C — Mobile route le CTA selon le contexte actif", () => {
  const home = read("Mobile/src/screens/HomeScreen.tsx");
  const helper = read("Mobile/src/lib/notificationInboxRoute.ts");
  const start = home.indexOf("platformNotifications:");
  assert.ok(start >= 0, "CTA Home notifications introuvable");
  const block = home.slice(start, home.indexOf("announcements:", start));
  assert.match(home, /resolveNotificationsInboxRoute/);
  assert.match(block, /resolveNotificationsInboxRoute/);
  assert.match(helper, /hasSchoolNotificationContext/);
  assert.match(
    helper,
    /canReadView\(session, "PlatformNotifications"\)/,
    "le catalogue B reste accessible hors contexte établissement",
  );
  assert.match(read("Mobile/src/components/CommunicationHeaderIcons.tsx"), /resolveNotificationsInboxRoute/);
  assert.match(read("Mobile/src/components/MobileAppHeader.tsx"), /resolveNotificationsInboxRoute/);
});

test("J-04 / RED-COM-06E — KPI Alertes à traiter = unread C4", () => {
  const topbar = read("web/src/components/layout/Topbar.tsx");
  const kpi = read("web/src/lib/scope.ts").slice(
    read("web/src/lib/scope.ts").indexOf("export function getLiveKpis"),
  );
  const overview = read("web/src/pages/OverviewPage.tsx");

  assert.match(topbar, /useInternalNotificationsUnreadCount/);
  assert.match(topbar, /hasInternalNotificationScope/);
  assert.match(kpi, /schoolUnreadCount/);
  assert.doesNotMatch(
    kpi,
    /notifications\.filter\(\(n\) => n\.status === "Non lu"\)/,
    "KPI Alertes à traiter compte encore les unread legacy (status Non lu)",
  );
  assert.doesNotMatch(
    kpi,
    /users\.filter\(\(u\) => !isActiveUserAccount/,
    "KPI Alertes à traiter ne doit plus compter les comptes inactifs",
  );
  assert.match(overview, /useInternalNotificationsUnreadCount/);
  assert.match(overview, /schoolUnreadCount/);
});
