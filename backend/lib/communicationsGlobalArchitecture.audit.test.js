"use strict";

/**
 * Audit de régression Communications après GREEN A/B.
 * Ce fichier ne porte plus de RED volontaire : il fige seulement les contrats
 * déjà corrigés par #544 et #545. Les écarts C→G restent documentés dans l'audit.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("AUDIT-COM-01 — fan-out PUSH/EMAIL après persist C4, jamais dans processOneEvent", () => {
  const fanoutPath = path.join(ROOT, "backend/lib/communicationChannelFanout.js");
  assert.equal(fs.existsSync(fanoutPath), true, "fan-out C4 manquant");

  const worker = read("backend/lib/communicationsNotificationsWorker.js");
  const runOnce = worker.slice(worker.indexOf("async function runOnce"));
  const drainCall = runOnce.indexOf("await drainOutbox");
  const fanoutCall = runOnce.indexOf("await fanOutNotificationChannels");
  assert.ok(drainCall >= 0 && fanoutCall > drainCall, "fan-out doit rester après drainOutbox");

  const service = read("backend/lib/communicationsNotificationsService.js");
  assert.doesNotMatch(service, /communicationChannelFanout|fanOutNotificationChannels/);
  assert.doesNotMatch(service, /expoPushService|nodemailer|sendMail|twilio/i);
});

test("AUDIT-COM-02 — ciblage Expo reste scoped user + school + environnement", () => {
  const store = read("backend/db/mobilePushDevicesStore.js");
  const pgList = store.slice(store.indexOf("async listActiveForUser"));
  const sqlBlock = pgList.slice(0, pgList.indexOf("async getByToken"));
  assert.match(sqlBlock, /user_id\s*=\s*\$/);
  assert.match(sqlBlock, /school_id\s*=\s*\$/);
  assert.match(sqlBlock, /backend_environment\s*=\s*\$/);

  const service = read("backend/lib/mobilePushDevicesService.js");
  const selfTest = service.slice(service.indexOf("async function sendSelfTest"));
  assert.match(selfTest, /sessionSchoolId/);
  assert.match(selfTest, /listActiveForUser\(\{[\s\S]*schoolId/);
});

test("AUDIT-COM-03 — un processing périmé n'est jamais redispatché", () => {
  const fanout = read("backend/lib/communicationChannelFanout.js");
  assert.match(fanout, /stale_processing_no_redelivery/);
  assert.match(fanout, /recoverStaleProcessing/);
  const sqlClaim = fanout.slice(fanout.indexOf("async claimDue"), fanout.indexOf("async markSent"));
  assert.match(sqlClaim, /status IN \('pending','failed'\)/);
  assert.doesNotMatch(sqlClaim, /status\s*=\s*'processing'.*claimed_at/s);
});

test("AUDIT-COM-04 — delivery_key reste unique pour l'idempotence de fan-out", () => {
  const schema = read("backend/db/communicationsNotificationsSchema.js");
  const migration = read("backend/db/migrations/20260907_communication_channel_deliveries.sql");
  assert.match(schema, /delivery_key\s+TEXT\s+NOT NULL\s+UNIQUE/);
  assert.match(migration, /delivery_key\s+TEXT\s+NOT NULL\s+UNIQUE/);
});
