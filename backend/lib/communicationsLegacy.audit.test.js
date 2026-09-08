"use strict";

/**
 * PR F — cartographie exécutable des silos notifications / annonces.
 * Ces tests sont VERTS : ils figent l'inventaire, pas la consolidation.
 * Les écarts à corriger sont dans communicationsLegacy.red.test.js.
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
  assert.match(c4, /Domaine volontairement distinct de la table plateforme `notifications`/);
});

test("AUDIT-COM-06-MAP-B — C3 établissement et annonces plateforme restent deux familles", () => {
  const schema = read("backend/db/schema.sql");
  const c3 = read("backend/db/communicationsAnnouncementsSchema.js");
  const platform = read("backend/db/platformAnnouncementsSchema.js");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS announcements \(/);
  assert.match(c3, /CREATE TABLE IF NOT EXISTS announcement_recipients \(/);
  assert.match(c3, /CREATE TABLE IF NOT EXISTS announcement_reads \(/);
  assert.match(platform, /CREATE TABLE IF NOT EXISTS platform_announcements \(/);
  assert.match(platform, /Domaine distinct de C3/);
  assert.match(platform, /Pas de school_id obligatoire/);
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

test("AUDIT-COM-06-MAP-D — APIs parallèles encore montées", () => {
  const server = read("backend/server.js");
  for (const route of [
    'app.get("/api/backoffice/notifications"',
    'app.post("/api/backoffice/notifications"',
    'app.patch("/api/backoffice/notifications/:notificationId"',
    'app.get("/api/backoffice/internal-notifications"',
    'app.get("/api/backoffice/internal-notifications/unread-count"',
    'app.get("/api/backoffice/announcements"',
    'app.get("/api/backoffice/announcements/unread-count"',
    'app.get("/api/backoffice/platform-announcements"',
    'app.get("/api/backoffice/platform-announcements/unread-count"',
  ]) {
    assert.match(server, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("AUDIT-COM-06-MAP-E — writers / readers legacy encore présents", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "backend/services/communicationService.js")), true);
  const platform = read("backend/lib/platformService.js");
  const pgStore = read("backend/db/platformPgStore.js");
  const c4 = read("backend/lib/communicationsNotificationsService.js");
  assert.match(platform, /async function createNotification/);
  assert.match(pgStore, /INSERT INTO notifications \(/);
  assert.doesNotMatch(c4, /FROM notifications /);
  assert.doesNotMatch(c4, /INTO notifications /);
});

test("AUDIT-COM-06-MAP-F — consumers Web et Mobile encore scindés", () => {
  const webPage = read("web/src/pages/NotificationsPage.tsx");
  const topbar = read("web/src/components/layout/Topbar.tsx");
  const announcements = read("web/src/pages/AnnouncementsPage.tsx");
  const home = read("Mobile/src/screens/HomeScreen.tsx");
  const platformScreen = read("Mobile/src/screens/PlatformNotificationsScreen.tsx");
  const internalScreen = read("Mobile/src/screens/InternalNotificationsScreen.tsx");
  assert.match(webPage, /InternalNotificationsCenter/);
  assert.match(webPage, /platformApi\.createNotification/);
  assert.match(topbar, /useInternalNotificationsUnreadCount/);
  assert.match(topbar, /scopedNotifications/);
  assert.match(announcements, /platformAnnouncementsApi\.list/);
  assert.match(announcements, /announcementsApi\.list/);
  assert.match(home, /PlatformNotifications/);
  assert.match(home, /InternalNotifications/);
  assert.match(platformScreen, /loadNotifications/);
  assert.match(internalScreen, /listInternalNotifications/);
});

test("AUDIT-COM-06-MAP-G — conservation C4 : announcement.published reste un pointeur inbox, pas une 2e table C3", () => {
  const service = read("backend/lib/communicationsNotificationsService.js");
  const block = service.slice(service.indexOf('eventType === "communication.announcement.published"'));
  assert.match(block, /FROM announcements WHERE id/);
  assert.match(block, /navigationTarget = \{ type: "announcement"/);
  const platformAnnouncements = read("backend/lib/platformAnnouncementsService.js");
  assert.doesNotMatch(platformAnnouncements, /communication_event_outbox|processOneEvent|fanOutNotificationChannels/);
});
