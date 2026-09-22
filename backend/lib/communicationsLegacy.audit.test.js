"use strict";

/**
 * PR F GREEN — cartographie des 4 familles après scission des lecteurs.
 * C3 et platform_announcements restent deux SoT distinctes.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("AUDIT-COM-06-MAP-A — deux tables notifications encore vivantes", () => {
  const schema = read("backend/db/schema.sql");
  const c4 = read("backend/db/communicationsNotificationsSchema.js");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS notifications \(/);
  assert.match(c4, /CREATE TABLE IF NOT EXISTS communication_notifications \(/);
  assert.match(c4, /CREATE TABLE IF NOT EXISTS notification_recipients \(/);
});

test("AUDIT-COM-06-MAP-B — C3 établissement et annonces plateforme restent deux familles", () => {
  const schema = read("backend/db/schema.sql");
  const c3 = read("backend/db/communicationsAnnouncementsSchema.js");
  const platform = read("backend/db/platformAnnouncementsSchema.js");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS announcements \(/);
  assert.match(c3, /CREATE TABLE IF NOT EXISTS announcement_recipients \(/);
  assert.match(platform, /CREATE TABLE IF NOT EXISTS platform_announcements \(/);
  assert.match(platform, /Domaine distinct de C3/);
});

test("AUDIT-COM-06-MAP-C — événements déjà drainés par C4", () => {
  const schema = read("backend/db/communicationsNotificationsSchema.js");
  const dispatcher = read("backend/lib/communicationsDispatcher.js");
  for (const eventType of [
    "communication.message.created",
    "communication.announcement.published",
    "attendance.student.absent",
    "pedagogy.grade.published",
    "finance.payment.recorded",
  ]) {
    assert.match(schema, new RegExp(eventType.replace(/\./g, "\\.")));
    assert.match(dispatcher, new RegExp(eventType.replace(/\./g, "\\.")));
  }
  assert.match(dispatcher, /auth\.password\.reset/);
});

test("AUDIT-COM-06-MAP-D — APIs parallèles encore montées (pas de drop famille B)", () => {
  const server = read("backend/server.js");
  for (const route of [
    'app.get("/api/backoffice/notifications"',
    'app.post("/api/backoffice/notifications"',
    'app.get("/api/backoffice/internal-notifications"',
    'app.get("/api/backoffice/announcements"',
    'app.get("/api/backoffice/platform-announcements"',
  ]) {
    assert.match(server, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("AUDIT-COM-06-MAP-E — C4 n'écrit pas la table notifications", () => {
  const c4 = read("backend/lib/communicationsNotificationsService.js");
  assert.doesNotMatch(c4, /FROM notifications /);
  assert.doesNotMatch(c4, /INTO notifications /);
});

test("AUDIT-COM-06-MAP-F — lecteurs Web scindés : /notifications = C4, catalogue B ailleurs", () => {
  const webPage = read("web/src/pages/NotificationsPage.tsx");
  const catalog = read("web/src/pages/PlatformNotificationsPage.tsx");
  const topbar = read("web/src/components/layout/Topbar.tsx");
  const announcements = read("web/src/pages/AnnouncementsPage.tsx");
  assert.match(webPage, /InternalNotificationsCenter/);
  assert.doesNotMatch(webPage, /platformApi/);
  assert.match(catalog, /platformApi\.createNotification/);
  assert.match(topbar, /useInternalNotificationsUnreadCount/);
  assert.match(topbar, /notifications-plateforme/);
  assert.match(announcements, /platformAnnouncementsApi\.list/);
  assert.match(announcements, /announcementsApi\.list/);
});

test("AUDIT-COM-06-MAP-G — announcement.published reste un pointeur inbox, pas une fusion C3/D", () => {
  const service = read("backend/lib/communicationsNotificationsService.js");
  const block = service.slice(service.indexOf('eventType === "communication.announcement.published"'));
  assert.match(block, /FROM announcements WHERE id/);
  assert.match(block, /navigationTarget = \{ type: "announcement"/);
  const platformAnnouncements = read("backend/lib/platformAnnouncementsService.js");
  assert.doesNotMatch(platformAnnouncements, /communication_event_outbox|processOneEvent|fanOutNotificationChannels/);
});
