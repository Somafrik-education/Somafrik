"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function exists(relative) {
  return fs.existsSync(path.join(ROOT, relative));
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
  const attachments = read("backend/lib/communicationsAttachments.js");
  const messages = read("backend/lib/communicationsMessagesService.js");
  const httpTest = read("backend/lib/communicationsC4.http.pg.test.js");
  const webApi = read("web/src/lib/internalNotificationsApi.ts");
  const webRead = read("web/src/lib/internalNotificationsRead.ts");
  const webCenter = read("web/src/components/communications/InternalNotificationsCenter.tsx");
  const topbar = read("web/src/components/layout/Topbar.tsx");
  const platformPage = read("web/src/pages/NotificationsPage.tsx");
  const placeholders = read("web/src/pages/parametres/SettingsPlaceholders.tsx");
  const settingsHub = read("web/src/pages/parametres/SettingsHubPage.tsx");
  const mobileApi = read("Mobile/src/services/internalNotificationsApi.ts");
  const mobileHttp = read("Mobile/src/services/httpClient.ts");
  const mobileRead = read("Mobile/src/lib/internalNotificationsRead.ts");
  const mobileScreen = read("Mobile/src/screens/InternalNotificationsScreen.tsx");
  const mobileHeader = read("Mobile/src/components/MobileAppHeader.tsx");
  const mobileIcons = read("Mobile/src/components/CommunicationHeaderIcons.tsx");
  const mobileNav = read("Mobile/src/navigation/AppNavigator.tsx");
  const mobileDrawer = read("Mobile/src/navigation/roleDrawerPreferences.ts");
  const schemaSql = read("backend/db/schema.sql");

  // 1-3 tables
  assert.match(schema, /communication_event_outbox/);
  assert.match(schema, /communication_notifications/);
  assert.match(schema, /notification_recipients/);
  assert.match(migration, /communication_event_outbox/);
  assert.match(migration, /communication_notifications/);
  assert.match(migration, /notification_recipients/);
  assert.match(bootstrap, /applyCommunicationsC4Schema/);

  // 4 event_key UNIQUE
  assert.match(schema, /event_key TEXT NOT NULL UNIQUE/);
  assert.match(migration, /event_key TEXT NOT NULL UNIQUE/);
  assert.match(schema, /ON CONFLICT \(event_key\) DO NOTHING/);

  // 5 read_at / archived_at par recipient
  assert.match(schema, /read_at TIMESTAMPTZ/);
  assert.match(schema, /archived_at TIMESTAMPTZ/);
  assert.match(service, /r\.read_at/);
  assert.match(service, /r\.archived_at/);

  // 6 aucune SoT locale read/unread
  assert.doesNotMatch(webCenter, /localStorage/);
  assert.doesNotMatch(webRead, /localStorage/);
  assert.doesNotMatch(mobileScreen, /localStorage|AsyncStorage/);
  assert.doesNotMatch(mobileRead, /localStorage|AsyncStorage/);
  assert.doesNotMatch(webApi, /localStorage/);
  assert.doesNotMatch(mobileApi, /AsyncStorage/);

  // 7-8 sender système / humain
  assert.match(service, /SYSTEM_SENDER_NAME = "Somafrik"/);
  assert.match(service, /sender_type, sender_user_id, sender_name/);
  assert.match(service, /'system',NULL/);
  assert.match(service, /displayName\(author\)/);
  assert.match(service, /seul le principal authentifié fait autorité/);

  // 9 request-scope
  assert.match(service, /requireSchool/);
  assert.match(messages, /Établissement requis \(effectiveSchoolCode\)/);
  assert.match(webApi, /withCommunicationSchoolScope/);
  assert.match(mobileApi, /withCommunicationSchoolScope/);

  // 10 entity_type=notification
  assert.match(service, /entityType: "notification"/);
  assert.match(service, /entity_type !== "notification"/);

  // 11 Notifications:READ sur download
  assert.match(rbac, /"GET \/api\/backoffice\/internal-notifications\/attachments\/:attachmentId": \["Notifications:READ"/);

  // 12-13 outbox idempotent + SKIP LOCKED
  assert.match(service, /FOR UPDATE SKIP LOCKED/);
  assert.match(service, /ON CONFLICT \(event_key\)/);
  assert.match(service, /attempts=attempts\+1/);
  assert.match(service, /last_error/);
  assert.match(service, /processed_at/);

  // 14 triggers
  assert.match(schema, /communication\.message\.created/);
  assert.match(schema, /communication\.announcement\.published/);
  assert.match(schema, /attendance\.student\.absent/);
  assert.match(schema, /pedagogy\.grade\.published/);
  assert.match(schema, /finance\.payment\.recorded/);
  assert.match(schema, /CREATE TRIGGER trg_c4_message_event/);
  assert.match(schema, /CREATE TRIGGER trg_c4_announcement_event/);
  assert.match(schema, /CREATE TRIGGER trg_c4_attendance_event/);
  assert.match(schema, /CREATE TRIGGER trg_c4_grade_event/);
  assert.match(schema, /CREATE TRIGGER trg_c4_payment_event/);
  assert.match(schema, /OLD\.publication_status/);
  assert.match(schema, /OLD\.payment_status/);
  assert.match(schema, /OLD\.status/);
  assert.doesNotMatch(schema, /COALESCE\(NEW\.publication_status, 'published'\)/);
  assert.doesNotMatch(schema, /COALESCE\(NEW\.status, 'published'\)/);

  // 15 ancienne table plateforme séparée
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS notifications \(/);
  assert.doesNotMatch(service, /FROM notifications /);
  assert.doesNotMatch(service, /INTO notifications /);

  // 16 /parametres/notifications ComingSoon
  assert.match(placeholders, /ComingSoonState/);
  assert.match(placeholders, /Paramètres Notifications/);
  assert.match(settingsHub, /\/parametres\/notifications/);
  assert.match(settingsHub, /status: "soon"/);

  // 17-18 badges unread-count
  assert.match(webRead, /\.unreadCount\(/);
  assert.match(topbar, /useInternalNotificationsUnreadCount/);
  assert.match(mobileRead, /getInternalNotificationsUnreadCount/);
  assert.match(mobileHeader, /useInternalNotificationsUnreadCount/);
  assert.match(mobileIcons, /useInternalNotificationsUnreadCount/);
  assert.match(mobileNav, /InternalNotifications/);
  assert.match(mobileDrawer, /InternalNotifications/);
  assert.match(platformPage, /InternalNotificationsCenter/);

  // 19 aucun DELETE physique
  assert.doesNotMatch(service, /DELETE FROM communication_notifications/);
  assert.doesNotMatch(service, /DELETE FROM notification_recipients/);
  assert.doesNotMatch(httpTest, /DELETE FROM communication_notifications/);

  // 20 aucun fournisseur externe
  assert.doesNotMatch(service, /twilio|whatsapp|firebase|expo push|fcm|smtp|sendgrid/i);
  assert.doesNotMatch(worker, /twilio|whatsapp|firebase|expo push|fcm/i);
  assert.match(worker, /COMMUNICATION_NOTIFICATIONS_WORKER/);
  assert.match(worker, /stopCommunicationsNotificationsWorker/);
  assert.match(server, /stopCommunicationsNotificationsWorker/);

  // Attachments reuse C2/C3, no cross-type OR
  assert.match(attachments, /ALLOWED_MIME/);
  assert.match(messages, /assertEntityTypeDownloadAccess/);
  assert.doesNotMatch(service, /Messages:READ[\s\S]{0,80}Announcements:READ[\s\S]{0,80}Notifications:READ/);

  assert.match(server, /GET \/api\/backoffice\/internal-notifications\/unread-count/);
  assert.match(server, /GET \/api\/backoffice\/internal-notifications/);
  assert.match(server, /POST \/api\/backoffice\/internal-notifications/);
  assert.match(server, /PATCH \/api\/backoffice\/internal-notifications\/:notificationId\/read/);
  assert.match(server, /PATCH \/api\/backoffice\/internal-notifications\/:notificationId\/archive/);
  assert.match(server, /internal-notifications\/attachments/);
  assert.match(rbac, /Notifications:READ/);
  assert.match(rbac, /Notifications:CREATE/);
  assert.match(rbac, /"PATCH \/api\/backoffice\/internal-notifications\/:notificationId\/archive": \["Notifications:READ"/);

  assert.match(webApi, /Idempotency-Key/);
  assert.match(mobileApi, /idempotencyKey/);
  assert.match(mobileHttp, /Idempotency-Key/);

  assert.match(httpTest, /C4-01/);
  assert.match(httpTest, /C4-02 auteur présent dans snapshot reçoit annonce/);
  assert.match(httpTest, /C4-02 UPDATE déjà published n'ajoute pas d'event/);
  assert.match(httpTest, /C4-03/);
  assert.match(httpTest, /C4-04 grade draft sans notification/);
  assert.match(httpTest, /C4-04 UPDATE note déjà published sans nouvel event/);
  assert.match(httpTest, /C4-05 pending sans notification/);
  assert.match(httpTest, /C4-05 UPDATE déjà paid sans nouvel event/);
  assert.match(httpTest, /C4-06 autre destinataire inchangé/);
  assert.match(httpTest, /C4-07/);
  assert.match(httpTest, /C4-08 senderName Somafrik/);
  assert.match(httpTest, /C4-09 spoof senderUserId ignoré/);
  assert.match(httpTest, /C4-10 \.exe refusé/);
  assert.match(httpTest, /C4-11 Messages:READ ne débloque pas PJ notification/);
  assert.match(httpTest, /C4-12 upload sans scope/);
  assert.match(httpTest, /C4-13 concurrence 1 notification/);
  assert.match(httpTest, /C4-14 rollback sans event/);
  assert.match(httpTest, /C4-15/);
  assert.match(httpTest, /C4-16 notification non supprimée/);

  assert.equal(exists(".github/workflows/com-c4-bootstrap.yml"), false, "workflow bootstrap temporaire absent");
  assert.equal(exists(".github/workflows/com-c4-finalize-patch.yml"), false, "workflow finalize temporaire absent");
  assert.equal(exists(".github/workflows/communications-c4.yml"), true);
  const workflow = read(".github/workflows/communications-c4.yml");
  assert.match(workflow, /npm --prefix Mobile run typecheck/);
  assert.doesNotMatch(workflow, /npx --prefix Mobile/);
  assert.match(schema, /information_schema\.columns/);
  assert.match(schema, /column_name = 'cancelled_at'/);
  assert.match(schema, /to_jsonb\(NEW\)->>'cancelled_at'/);
  assert.match(schema, /to_jsonb\(OLD\)->>'cancelled_at'/);

  console.log("verify-communications-c4: source guards OK");
}

function main() {
  sourceGuards();
  run(process.execPath, ["--check", "backend/lib/communicationsNotificationsService.js"], "syntax notifications service");
  run(process.execPath, ["--check", "backend/lib/communicationsNotificationsWorker.js"], "syntax notifications worker");
  run(process.execPath, ["--check", "backend/server.js"], "syntax server");
  run(process.execPath, ["backend/lib/communicationsAttachments.test.js"], "communicationsAttachments unit");
  run("npm", ["--prefix", "web", "run", "test", "--", "src/lib/internalNotificationsC4.test.ts"], "web internal notifications C4");
  run("npx", ["--yes", "tsx", "Mobile/src/lib/internalNotificationsC4.test.ts"], "mobile internal notifications C4");
  assert.ok(String(process.env.DATABASE_URL ?? "").trim(), "DATABASE_URL requis pour COM-C4");
  run(process.execPath, ["backend/lib/communicationsC4.http.pg.test.js"], "parcours HTTP PostgreSQL COM-C4");
  console.log("verify-communications-c4: GO");
}

main();
