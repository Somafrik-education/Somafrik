"use strict";

/**
 * AUDIT-COM-FINAL — gel de la chaîne H→K sur develop@a9400c26.
 * Inventaire uniquement : aucun RED volontaire, aucune correction métier.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function walkJs(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "coverage") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, acc);
    else if (entry.name.endsWith(".js")) acc.push(full);
  }
  return acc;
}

test("AUDIT-COM-FINAL-01 — unique caller runtime fanOutNotificationChannels = dispatcher", () => {
  const backendJs = walkJs(path.join(ROOT, "backend/lib")).concat(
    walkJs(path.join(ROOT, "backend/services")),
    [path.join(ROOT, "backend/server.js")],
  );
  const callers = backendJs
    .filter((abs) => !abs.endsWith(".test.js") && !abs.includes(".red."))
    .filter((abs) => /await\s+fanOutNotificationChannels\s*\(/.test(fs.readFileSync(abs, "utf8")))
    .map((abs) => path.relative(ROOT, abs).replaceAll("\\", "/"));
  assert.deepEqual(callers, ["backend/lib/communicationsDispatcher.js"]);
});

test("AUDIT-COM-FINAL-02 — worker drainOutbox puis dispatchProcessedEvents, sans SDK", () => {
  const worker = read("backend/lib/communicationsNotificationsWorker.js");
  const runOnce = worker.slice(worker.indexOf("async function runOnce"));
  const drainCall = runOnce.indexOf("await drainOutbox");
  const dispatchCall = runOnce.indexOf("await dispatchProcessedEvents");
  assert.ok(drainCall >= 0 && dispatchCall > drainCall);
  assert.doesNotMatch(runOnce, /fanOutNotificationChannels|nodemailer|expoPushService/);
});

test("AUDIT-COM-FINAL-03 — quatre familles SoT toujours distinctes", () => {
  const schema = read("backend/db/schema.sql");
  const c4 = read("backend/db/communicationsNotificationsSchema.js");
  const c3 = read("backend/db/communicationsAnnouncementsSchema.js");
  const platform = read("backend/db/platformAnnouncementsSchema.js");
  assert.match(c4, /CREATE TABLE IF NOT EXISTS communication_notifications/);
  assert.match(c4, /CREATE TABLE IF NOT EXISTS notification_recipients/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS notifications \(/);
  assert.match(c3, /CREATE TABLE IF NOT EXISTS announcement_recipients/);
  assert.match(platform, /CREATE TABLE IF NOT EXISTS platform_announcements/);
  const server = read("backend/server.js");
  assert.match(server, /\/api\/backoffice\/internal-notifications/);
  assert.match(server, /\/api\/backoffice\/notifications"/);
  assert.match(server, /\/api\/backoffice\/announcements"/);
  assert.match(server, /\/api\/backoffice\/platform-announcements"/);
});

test("AUDIT-COM-FINAL-04 — PUSH Expo / EMAIL SMTP ; pas SMS/WhatsApp/Brevo SDK dans le fan-out", () => {
  const fanout = read("backend/lib/communicationChannelFanout.js");
  assert.match(fanout, /const CHANNELS = Object\.freeze\(\["PUSH", "EMAIL"\]\)/);
  assert.match(fanout, /createExpoPushService/);
  assert.match(fanout, /nodemailer/);
  assert.doesNotMatch(fanout, /twilio|whatsapp|@getbrevo|sendgrid/i);
  const dispatcher = read("backend/lib/communicationsDispatcher.js");
  assert.doesNotMatch(
    dispatcher,
    /nodemailer|expoPushService|@getbrevo|twilio/i,
  );
});

test("AUDIT-COM-FINAL-05 — Lot K : dead_letter, reclaim, consensus pays, diagnostic sans PII", () => {
  const fanout = read("backend/lib/communicationChannelFanout.js");
  assert.match(fanout, /DEAD_LETTER_STATUS = "dead_letter"/);
  assert.match(fanout, /dispatch_started_at/);
  assert.match(fanout, /stale_lease_reclaimed/);
  assert.match(fanout, /stale_processing_no_redelivery/);
  assert.match(fanout, /sanitizeDeliveryLastError/);
  const health = read("backend/lib/communicationsDeliveryHealth.js");
  assert.match(health, /getCountryCodeFromScope\(principal\?\.countryCode\)/);
  assert.match(health, /getCountryCodeFromScope\(principal\?\.countryScope\)/);
  assert.match(health, /getCountryCodeFromScope\(ctx\?\.countryCode\)/);
  assert.match(health, /distinct\.length === 1/);
  const server = read("backend/server.js");
  assert.match(server, /\/api\/backoffice\/communications\/deliveries\/health/);
});

test("AUDIT-COM-FINAL-06 — prefs AND école ; EMAIL reset mandatory", () => {
  const dispatcher = read("backend/lib/communicationsDispatcher.js");
  assert.match(dispatcher, /auth\.password\.reset/);
  assert.match(dispatcher, /EVENT_MANDATORY_CHANNEL_POLICY/);
  assert.match(dispatcher, /resolveAllowedChannels/);
  const policy = read("backend/lib/schoolNotificationPolicy.js");
  assert.match(policy, /auth\.password\.reset/);
  const reset = read("backend/lib/passwordResetNotification.js");
  assert.match(reset, /ensureDelivery/);
  assert.match(reset, /channel:\s*"EMAIL"/);
  assert.doesNotMatch(reset, /nodemailer|createTransport|sendMail/);
});

test("AUDIT-COM-FINAL-07 — J-01 paiement sans catalogue B ; unpaid relance reste dette B", () => {
  const paymentTx = read("backend/services/paymentTransactionService.js");
  assert.doesNotMatch(paymentTx, /notifications:\s*\[notification/);
  const unpaid = read("backend/services/unpaidService.js");
  assert.match(unpaid, /notifications: notification \? \[notification/);
  assert.doesNotMatch(unpaid, /fanOutNotificationChannels|expoPushService|nodemailer/);
});

test("AUDIT-COM-FINAL-08 — Web/Mobile inbox C4 vs catalogue selon contexte", () => {
  const webPage = read("web/src/pages/NotificationsPage.tsx");
  const app = read("web/src/App.tsx");
  assert.match(webPage, /InternalNotificationsCenter/);
  assert.match(app, /notifications-plateforme/);
  const mobile = read("Mobile/src/lib/notificationInboxRoute.ts");
  assert.match(mobile, /resolveNotificationsInboxRoute/);
  assert.match(mobile, /InternalNotifications/);
  assert.match(mobile, /PlatformNotifications/);
});

test("AUDIT-COM-FINAL-09 — migrations reliability / prefs / école présentes au bootstrap C4", () => {
  const schema = read("backend/db/communicationsNotificationsSchema.js");
  assert.match(schema, /dispatch_started_at/);
  assert.match(schema, /user_communication_preferences/);
  assert.match(schema, /school_notification_settings/);
  const bootstrap = read("backend/db/clientsCanonicalBootstrap.js");
  assert.match(bootstrap, /applyCommunicationsC4Schema/);
  assert.equal(fs.existsSync(path.join(ROOT, "backend/db/migrations/20260908_communication_channel_deliveries_reliability.sql")), true);
  assert.equal(fs.existsSync(path.join(ROOT, "backend/db/migrations/20260910_user_communication_preferences.sql")), true);
  assert.equal(fs.existsSync(path.join(ROOT, "backend/db/migrations/20260912_school_notification_settings.sql")), true);
});
