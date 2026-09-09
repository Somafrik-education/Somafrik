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
  assert.match(schema, /communication_channel_deliveries/);
  assert.match(migration, /communication_event_outbox/);
  assert.match(migration, /communication_notifications/);
  assert.match(migration, /notification_recipients/);
  const channelMigration = read("backend/db/migrations/20260907_communication_channel_deliveries.sql");
  assert.match(channelMigration, /communication_channel_deliveries/);
  const reliabilityMigration = read("backend/db/migrations/20260908_communication_channel_deliveries_reliability.sql");
  assert.match(reliabilityMigration, /dispatch_started_at/);
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
  assert.match(schema, /pedagogy\.report_card\.published/);
  assert.match(schema, /planning\.timetable\.changed/);
  assert.match(schema, /finance\.payment\.recorded/);
  assert.match(read("backend/lib/communicationsPaymentDueSweep.js"), /finance\.payment\.due/);
  assert.match(schema, /CREATE TRIGGER trg_c4_message_event/);
  assert.match(schema, /CREATE TRIGGER trg_c4_announcement_event/);
  assert.match(schema, /CREATE TRIGGER trg_c4_attendance_event/);
  assert.match(schema, /CREATE TRIGGER trg_c4_grade_event/);
  assert.match(schema, /CREATE TRIGGER trg_c4_payment_event/);
  assert.match(schema, /trg_c4_report_card_event/);
  assert.match(schema, /trg_c4_timetable_changed_event/);
  assert.match(schema, /OLD\.publication_status/);
  assert.match(schema, /OLD\.payment_status/);
  assert.match(schema, /OLD\.status/);
  assert.doesNotMatch(schema, /COALESCE\(NEW\.publication_status, 'published'\)/);
  assert.doesNotMatch(schema, /COALESCE\(NEW\.status, 'published'\)/);

  // 15 ancienne table plateforme séparée
  assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS notifications \(/);
  assert.doesNotMatch(service, /FROM notifications /);
  assert.doesNotMatch(service, /INTO notifications /);

  // 16 /parametres/notifications = config établissement Lot I ; Apparence/Intégrations restent ComingSoon
  assert.match(placeholders, /ComingSoonState/);
  assert.match(placeholders, /function SettingsAppearancePage/);
  assert.match(placeholders, /export \{ SettingsNotificationsPage \}/);
  assert.match(settingsHub, /\/parametres\/notifications/);
  const notificationsCard = settingsHub.slice(
    settingsHub.indexOf('to: "/parametres/notifications"'),
    settingsHub.indexOf('to: "/parametres/apparence"'),
  );
  assert.match(notificationsCard, /status: "available"/);
  assert.match(
    settingsHub.slice(settingsHub.indexOf('to: "/parametres/apparence"'), settingsHub.indexOf('to: "/parametres/integrations"')),
    /status: "soon"/,
  );

  // 17-18 badges unread-count
  assert.match(webRead, /\.unreadCount\(/);
  assert.match(topbar, /useInternalNotificationsUnreadCount/);
  assert.match(mobileRead, /getInternalNotificationsUnreadCount/);
  assert.match(mobileHeader, /useInternalNotificationsUnreadCount/);
  assert.match(mobileIcons, /useInternalNotificationsUnreadCount/);
  assert.match(mobileNav, /InternalNotifications/);
  assert.match(mobileDrawer, /InternalNotifications/);
  assert.match(platformPage, /InternalNotificationsCenter/);
  assert.doesNotMatch(platformPage, /platformApi/);
  assert.equal(exists("web/src/pages/PlatformNotificationsPage.tsx"), true);
  assert.match(read("web/src/pages/PlatformNotificationsPage.tsx"), /platformApi\.createNotification/);

  // 19 aucun DELETE physique
  assert.doesNotMatch(service, /DELETE FROM communication_notifications/);
  assert.doesNotMatch(service, /DELETE FROM notification_recipients/);
  assert.doesNotMatch(httpTest, /DELETE FROM communication_notifications/);

  // 20 persist C4 sans fournisseur ; fan-out PUSH/EMAIL après drain
  assert.doesNotMatch(service, /twilio|whatsapp|firebase|expo push|fcm|smtp|sendgrid/i);
  assert.doesNotMatch(service, /communicationChannelFanout|fanOutNotificationChannels|communicationsDispatcher/);
  const processFn = service.slice(service.indexOf("async function processOneEvent"));
  const recipientLoop = processFn.slice(
    processFn.indexOf("for (const recipient of spec.recipients)"),
    processFn.indexOf("UPDATE communication_event_outbox SET status='processed'"),
  );
  assert.match(recipientLoop, /INSERT INTO notification_recipients/);
  assert.doesNotMatch(recipientLoop, /continue/);
  assert.doesNotMatch(worker, /twilio|whatsapp|firebase|expoPushService|nodemailer/i);
  assert.match(worker, /dispatchProcessedEvents|communicationsDispatcher/);
  assert.match(worker, /sweepPaymentDueOutbox/);
  assert.doesNotMatch(worker, /fanOutNotificationChannels/);
  const dispatcherSrc = read("backend/lib/communicationsDispatcher.js");
  assert.match(dispatcherSrc, /function dispatchCommunication/);
  assert.doesNotMatch(
    dispatcherSrc,
    /nodemailer|expoPushService|createExpoPushService|expo-server-sdk|@getbrevo|brevo|twilio|sendgrid|createSmtpTransport/i,
  );
  assert.match(dispatcherSrc, /function resolveEffectiveChannels/);
  assert.match(dispatcherSrc, /function mandatoryChannelsForEvent/);
  assert.match(dispatcherSrc, /auth\.password\.reset/);
  const prefsSrc = read("backend/lib/communicationsPreferences.js");
  assert.doesNotMatch(prefsSrc, /require\(["'][^"']*(nodemailer|expo-server-sdk|@getbrevo)/);
  assert.doesNotMatch(prefsSrc, /mobile_push_devices|expo_push_token/);
  const prefsSchema = read("backend/db/communicationsNotificationsSchema.js");
  assert.match(prefsSchema, /user_communication_preferences/);
  assert.match(prefsSchema, /PRIMARY KEY \(user_id, school_id, channel\)/);
  const prefsMigration = read("backend/db/migrations/20260910_user_communication_preferences.sql");
  assert.match(prefsMigration, /user_communication_preferences/);
  assert.doesNotMatch(prefsMigration, /preferred_provider|push_provider|expo_push_token/i);
  const resetHandler = read("backend/server.js");
  const resetBlock = resetHandler.slice(
    resetHandler.indexOf('app.post("/api/users/:id/reset-password"'),
    resetHandler.indexOf('app.get("/api/payments"'),
  );
  assert.match(resetBlock, /enqueuePasswordResetNotification/);
  assert.match(resetBlock, /auth\.password\.reset/);
  assert.match(resetBlock, /if\s*\(\s*!temporaryPassword\s*\)/);
  const resetTx = resetBlock.slice(resetBlock.indexOf("repository.withTransaction"), resetBlock.indexOf("await auditService.record"));
  assert.doesNotMatch(resetTx, /sendMail|nodemailer|setImmediate/);
  assert.doesNotMatch(resetBlock, /processOneEvent|communication_event_outbox/);
  const resetEmail = read("backend/lib/passwordResetNotification.js");
  assert.doesNotMatch(resetEmail, /temporaryPassword|SMTP_PASSWORD|brevo/i);
  const trialHandler = read("backend/server.js");
  const trialBlock = trialHandler.slice(
    trialHandler.indexOf('app.post("/api/public/trial-requests"'),
    trialHandler.indexOf('app.get("/api/privacy/erasure-requests"'),
  );
  assert.doesNotMatch(trialBlock, /deferNotification|sendMail|nodemailer|setImmediate/);
  const trialCreate = read("backend/lib/trialAccessRequests.js");
  assert.match(trialCreate, /enqueueTrialAccessRequestNotification/);
  assert.match(trialCreate, /withTransaction/);
  assert.doesNotMatch(trialCreate, /notifyTrialAccessRequest|setImmediate|nodemailer/);
  const trialNotify = read("backend/lib/trialAccessRequestNotification.js");
  assert.match(trialNotify, /trial\.access\.request:/);
  assert.match(trialNotify, /ensureDelivery/);
  assert.doesNotMatch(trialNotify, /nodemailer|sendMail|createTransport/);
  assert.doesNotMatch(trialNotify, /processOneEvent|fanOutNotificationChannels/);
  assert.match(schema, /communication_channel_deliveries_recipient_chk/);
  const trialMigration = read("backend/db/migrations/20260911_trial_operational_email_deliveries.sql");
  assert.match(trialMigration, /communication_channel_deliveries_recipient_chk/);
  assert.match(trialMigration, /payload->>'to'/);
  const fanout = read("backend/lib/communicationChannelFanout.js");
  assert.match(fanout, /function operationalTrialEmailTo/);
  assert.match(fanout, /trial\.access\.request/);
  const enqueueFn = fanout.slice(fanout.indexOf("async function enqueueChannelDeliveries"));
  assert.match(enqueueFn, /preference lookup failed, enqueue policy channels/);
  assert.match(fanout, /stale_processing_no_redelivery/);
  assert.match(fanout, /recoverStaleProcessing/);
  const sqlClaim = fanout.slice(fanout.indexOf("async claimDue"), fanout.indexOf("async markSent"));
  assert.match(sqlClaim, /status IN \('pending','failed'\)/);
  assert.doesNotMatch(sqlClaim, /status = 'processing' AND claimed_at/);
  const fanoutTests = read("backend/lib/communicationChannelFanout.test.js");
  assert.match(fanoutTests, /crash après succès Expo avant markSent n'envoie pas une seconde fois/);
  assert.match(fanoutTests, /crash après succès SMTP avant markSent n'envoie pas une seconde fois/);
  assert.match(fanoutTests, /payload.to n'override pas l'email tenant scoped user\+school/);
  assert.match(fanoutTests, /EMAIL opérationnel trial.access.request utilise payload.to sans user\/school/);
  assert.match(fanoutTests, /smtp_not_configured laisse la delivery EMAIL retryable/);
  assert.match(fanout, /SMTP_NOT_CONFIGURED/);
  assert.match(fanout.slice(fanout.indexOf("async function drainChannelDeliveries")), /markFailed/);
  assert.match(worker, /COMMUNICATION_NOTIFICATIONS_WORKER/);
  assert.match(worker, /stopCommunicationsNotificationsWorker/);
  assert.match(server, /stopCommunicationsNotificationsWorker/);

  // Attachments reuse C2/C3, no cross-type OR
  assert.match(attachments, /ALLOWED_MIME/);
  assert.match(messages, /assertEntityTypeDownloadAccess/);
  assert.doesNotMatch(service, /Messages:READ[\s\S]{0,80}Announcements:READ[\s\S]{0,80}Notifications:READ/);

  assert.match(server, /GET \/api\/backoffice\/internal-notifications\/unread-count/);
  assert.match(server, /GET \/api\/backoffice\/communications\/deliveries\/health/);
  assert.match(rbac, /GET \/api\/backoffice\/communications\/deliveries\/health/);
  assert.match(schema, /dispatch_started_at/);
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
  assert.match(workflow, /working-directory: Mobile/);
  assert.match(workflow, /npx tsc --noEmit --project tsconfig\.json/);
  assert.doesNotMatch(workflow, /npx --prefix Mobile/);
  assert.doesNotMatch(workflow, /\|\| true/);
  assert.match(schema, /information_schema\.columns/);
  assert.match(schema, /column_name = 'cancelled_at'/);
  assert.match(schema, /to_jsonb\(NEW\)->>'cancelled_at'/);
  assert.match(schema, /to_jsonb\(OLD\)->>'cancelled_at'/);
  assert.doesNotMatch(schema, /ALTER TABLE payments ADD COLUMN.*cancelled_at/);

  const bootstrapTest = read("backend/db/communicationsC4.bootstrap.pg.test.js");
  assert.match(bootstrapTest, /CAS A payments sans cancelled_at/);
  assert.match(bootstrapTest, /CAS A pending → paid produit exactement 1 outbox event/);
  assert.match(bootstrapTest, /CAS B cancelled_at présent \(Finance\)/);
  assert.match(bootstrapTest, /CAS B paid non cancelled = event/);
  assert.match(bootstrapTest, /CAS B cancelled = pas d'event parasite/);
  assert.match(bootstrapTest, /CAS B update déjà paid = aucun doublon/);
  assert.match(bootstrapTest, /ensureClientsCanonicalBootstrap/);
  assert.doesNotMatch(bootstrapTest, /FINANCE_SCHEMA_SQL/);

  console.log("verify-communications-c4: source guards OK");
}

function main() {
  sourceGuards();
  run(process.execPath, ["--check", "backend/lib/communicationsNotificationsService.js"], "syntax notifications service");
  run(process.execPath, ["--check", "backend/lib/communicationsNotificationsWorker.js"], "syntax notifications worker");
  run(process.execPath, ["--check", "backend/lib/communicationChannelFanout.js"], "syntax channel fanout");
  run(process.execPath, ["--check", "backend/lib/communicationsDispatcher.js"], "syntax dispatcher");
  run(process.execPath, ["--check", "backend/lib/passwordResetNotification.js"], "syntax password reset email");
  run(process.execPath, ["--test", "backend/lib/communicationsChannelFanout.red-com-01.test.js"], "RED-COM-01 / 01b");
  run(process.execPath, ["--test", "backend/lib/communicationsDispatcher.red.test.js"], "RED-COM-04 dispatcher audit");
  run(process.execPath, ["--test", "backend/lib/communicationsDispatcher.test.js"], "dispatcher unit");
  run(process.execPath, ["--test", "backend/lib/communicationsPreferences.test.js"], "preferences unit");
  run(process.execPath, ["--test", "backend/lib/communicationsGlobalArchitecture.audit.test.js"], "architecture audit unique caller");
  run(process.execPath, ["--test", "backend/lib/communicationChannelFanout.test.js"], "channel fanout unit");
  run(process.execPath, ["--test", "backend/lib/communicationsPasswordReset.red.test.js"], "PR C reset email source");
  run(process.execPath, ["--test", "backend/lib/passwordResetNotification.test.js"], "password reset email unit");
  run(process.execPath, ["--check", "backend/server.js"], "syntax server");
  run(process.execPath, ["backend/lib/communicationsAttachments.test.js"], "communicationsAttachments unit");
  run("npm", ["--prefix", "web", "run", "test", "--", "src/lib/internalNotificationsC4.test.ts"], "web internal notifications C4");
  run("npm", ["--prefix", "web", "run", "test", "--", "src/lib/dashboardKpiTruth.test.ts"], "web KPI Alertes C4");
  run("npm", ["--prefix", "web", "run", "test", "--", "src/lib/dashboardPermissions.test.ts"], "web Lot J P1 RBAC operations");
  run("npx", ["--yes", "tsx", "Mobile/src/lib/internalNotificationsC4.test.ts"], "mobile internal notifications C4");
  run("npx", ["--yes", "tsx", "Mobile/src/lib/notificationInboxRoute.test.ts"], "mobile inbox routing context");
  assert.ok(String(process.env.DATABASE_URL ?? "").trim(), "DATABASE_URL requis pour COM-C4");
  run(process.execPath, ["backend/db/communicationsC4.bootstrap.pg.test.js"], "bootstrap payments cancelled_at CAS A/B");
  run(process.execPath, ["backend/lib/communicationsC4.http.pg.test.js"], "parcours HTTP PostgreSQL COM-C4");
  // PR E — contrats préférences #551. Ne pas SKIP.
  run(process.execPath, ["--test", "backend/lib/communicationsPreferences.red.test.js"], "RED-COM-05 preferences audit");
  run(process.execPath, ["--test", "backend/lib/communicationsLegacy.audit.test.js"], "PR F legacy inventory");
  run(process.execPath, ["--test", "backend/lib/communicationsLegacy.red.test.js"], "RED-COM-06 legacy consolidation");
  // PR G — SMTP essai → delivery EMAIL. Ne pas SKIP.
  run(process.execPath, ["--test", "backend/lib/communicationsTrialSmtp.red.test.js"], "RED-COM-07 trial SMTP durable");
  run(process.execPath, ["--test", "backend/lib/communicationsDeliveryReliability.red.test.js"], "RED-COM-08 delivery reliability");
  run(process.execPath, ["--test", "backend/lib/communicationsDeliveryHealth.test.js"], "Lot K delivery health");
  run(process.execPath, ["--test", "backend/lib/communicationsFinal.audit.test.js"], "AUDIT-COM-FINAL audit H-K");
  run(process.execPath, ["--test", "backend/lib/communicationsStudentLate.red.test.js"], "Lot L1 STUDENT_LATE RED/GREEN");
  run(process.execPath, ["--test", "backend/lib/communicationsReportCardPublished.red.test.js"], "Lot L2 REPORT_CARD_PUBLISHED RED/GREEN");
  run(process.execPath, ["--test", "backend/lib/communicationsPaymentDue.red.test.js"], "Lot L3 PAYMENT_DUE RED/GREEN");
  run(process.execPath, ["--test", "backend/lib/communicationsTimetableChanged.red.test.js"], "Lot L4 TIMETABLE_CHANGED RED/GREEN");
  run(process.execPath, ["--test", "backend/lib/trialAccessRequestNotification.red.test.js"], "trial EMAIL durable unit");
  run(process.execPath, ["--test", "backend/lib/schoolNotificationSettings.test.js"], "Lot I school notification settings");
  run("npm", ["--prefix", "web", "run", "test", "--", "src/pages/parametres/SettingsNotificationsPage.test.tsx"], "web Lot I notification settings");
  console.log("verify-communications-c4: GO");
}

main();
