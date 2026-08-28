"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function run(cmd, args, label) {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, label);
}

function sourceGuards() {
  const schema = read("backend/db/communicationsNotificationsSchema.js");
  const migration = read("backend/db/migrations/20260828_communications_c4_internal_notifications.sql");
  const bootstrap = read("backend/db/clientsCanonicalBootstrap.js");
  const service = read("backend/lib/communicationsNotificationsService.js");
  const worker = read("backend/lib/communicationsNotificationsWorker.js");
  const server = read("backend/server.js");
  const rbac = read("backend/services/rbacService.js");
  const httpTest = read("backend/lib/communicationsC4.http.pg.test.js");
  const webApi = read("web/src/lib/internalNotificationsApi.ts");
  const webRead = read("web/src/lib/internalNotificationsRead.ts");
  const webCenter = read("web/src/components/communications/InternalNotificationsCenter.tsx");
  const topbar = read("web/src/components/layout/Topbar.tsx");
  const platformPage = read("web/src/pages/NotificationsPage.tsx");
  const mobileApi = read("Mobile/src/services/internalNotificationsApi.ts");
  const mobileRead = read("Mobile/src/lib/internalNotificationsRead.ts");
  const mobileScreen = read("Mobile/src/screens/InternalNotificationsScreen.tsx");
  const mobileHeader = read("Mobile/src/components/CommunicationHeaderIcons.tsx");
  const mobileNav = read("Mobile/src/navigation/AppNavigator.tsx");

  assert.match(schema, /communication_event_outbox/);
  assert.match(schema, /communication_notifications/);
  assert.match(schema, /notification_recipients/);
  assert.match(schema, /communication\.message\.created/);
  assert.match(schema, /communication\.announcement\.published/);
  assert.match(schema, /attendance\.student\.absent/);
  assert.match(schema, /pedagogy\.grade\.published/);
  assert.match(schema, /finance\.payment\.recorded/);
  assert.match(schema, /ON CONFLICT \(event_key\) DO NOTHING/);
  assert.match(migration, /communication_event_outbox/);
  assert.match(migration, /communication_notifications/);
  assert.match(migration, /notification_recipients/);
  assert.match(bootstrap, /applyCommunicationsC4Schema/);

  assert.match(service, /FOR UPDATE SKIP LOCKED/);
  assert.match(service, /event_key/);
  assert.match(service, /sender_type/);
  assert.match(service, /Somafrik/);
  assert.match(service, /addExact/);
  assert.match(service, /announcement_recipients/);
  assert.match(service, /listParentUserIdsForStudent/);
  assert.match(service, /entity_type = 'notification'|entityType: "notification"/);
  assert.match(service, /read_at/);
  assert.match(service, /archived_at/);
  assert.doesNotMatch(service, /twilio|whatsapp|firebase|expo push|fcm/i);

  assert.match(worker, /drainOutbox/);
  assert.match(worker, /COMMUNICATION_NOTIFICATIONS_WORKER/);
  assert.match(server, /GET \/api\/backoffice\/internal-notifications\/unread-count/);
  assert.match(server, /GET \/api\/backoffice\/internal-notifications/);
  assert.match(server, /POST \/api\/backoffice\/internal-notifications/);
  assert.match(server, /PATCH \/api\/backoffice\/internal-notifications\/:notificationId\/read/);
  assert.match(server, /PATCH \/api\/backoffice\/internal-notifications\/:notificationId\/archive/);
  assert.match(server, /internal-notifications\/attachments/);
  assert.match(rbac, /Notifications:READ/);
  assert.match(rbac, /Notifications:CREATE/);
  assert.match(rbac, /Notifications:UPDATE/);
  assert.match(rbac, /internal-notifications/);

  assert.match(webApi, /internal-notifications/);
  assert.match(webApi, /Idempotency-Key/);
  assert.match(webRead, /\.unreadCount\(/);
  assert.match(webCenter, /markRead|mark.*read/i);
  assert.match(topbar, /useInternalNotificationsUnreadCount/);
  assert.match(platformPage, /InternalNotificationsCenter/);
  assert.doesNotMatch(webCenter, /localStorage/);

  assert.match(mobileApi, /internal-notifications/);
  assert.match(mobileApi, /Idempotency-Key/);
  assert.match(mobileRead, /\.unreadCount\(/);
  assert.match(mobileScreen, /markRead|mark.*read/i);
  assert.match(mobileHeader, /useInternalNotificationsUnreadCount/);
  assert.match(mobileNav, /InternalNotifications/);
  assert.doesNotMatch(mobileScreen, /localStorage/);

  assert.match(httpTest, /C4-01/);
  assert.match(httpTest, /C4-02 auteur présent dans snapshot reçoit annonce/);
  assert.match(httpTest, /C4-03/);
  assert.match(httpTest, /C4-04/);
  assert.match(httpTest, /C4-05/);
  assert.match(httpTest, /C4-06/);
  assert.match(httpTest, /C4-09\/10/);
  assert.match(httpTest, /C4-11/);
  assert.match(httpTest, /C4-12/);
  assert.match(httpTest, /C4-13/);
  assert.match(httpTest, /C4-14/);
  assert.match(httpTest, /C4-15/);
  assert.match(httpTest, /C4-16/);

  console.log("verify-communications-c4: source guards OK");
}

function main() {
  sourceGuards();
  run(process.execPath, ["--check", "backend/lib/communicationsNotificationsService.js"], "syntax notifications service");
  run(process.execPath, ["--check", "backend/lib/communicationsNotificationsWorker.js"], "syntax notifications worker");
  run(process.execPath, ["--check", "backend/server.js"], "syntax server");
  assert.ok(String(process.env.DATABASE_URL ?? "").trim(), "DATABASE_URL requis pour COM-C4");
  run(process.execPath, ["backend/lib/communicationsC4.http.pg.test.js"], "parcours HTTP PostgreSQL COM-C4");
  console.log("verify-communications-c4: GO — PostgreSQL réel, outbox transactionnelle, RBAC/tenant et pièces jointes validés");
}

main();
