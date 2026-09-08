"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("RED-COM-01 P1 — adaptateur PUSH/EMAIL après persist C4", () => {
  const fanout = path.join(ROOT, "backend/lib/communicationChannelFanout.js");
  assert.equal(fs.existsSync(fanout), true, "backend/lib/communicationChannelFanout.js manquant");
  const worker = read("backend/lib/communicationsNotificationsWorker.js");
  assert.match(
    worker,
    /communicationChannelFanout|fanOutNotificationChannels/,
    "le worker C4 doit déclencher le fan-out canal après drainOutbox",
  );
  const runOnce = worker.slice(worker.indexOf("async function runOnce"));
  const drainCall = runOnce.indexOf("await drainOutbox");
  const fanCall = runOnce.indexOf("await fanOutNotificationChannels");
  assert.ok(drainCall >= 0 && fanCall > drainCall, "fan-out après drainOutbox, pas avant persist");
});

test("RED-COM-01c — processing périmé n'est pas redispatched", () => {
  const fanout = read("backend/lib/communicationChannelFanout.js");
  assert.match(fanout, /stale_processing_no_redelivery/);
  assert.match(fanout, /recoverStaleProcessing/);
  const sqlClaim = fanout.slice(fanout.indexOf("async claimDue"), fanout.indexOf("async markSent"));
  assert.match(sqlClaim, /status IN \('pending','failed'\)/);
  assert.doesNotMatch(
    sqlClaim,
    /status = 'processing' AND claimed_at/,
    "claimDue ne doit pas reprendre processing pour un second envoi",
  );
});

test("RED-COM-01b — C4 persist reste sans fournisseur", () => {
  const service = read("backend/lib/communicationsNotificationsService.js");
  assert.doesNotMatch(service, /expoPushService|nodemailer|sendMail|twilio/i);
  const processFn = service.slice(service.indexOf("async function processOneEvent"));
  assert.doesNotMatch(processFn.slice(0, 2500), /listActiveForUser|sendToTokens/);
  assert.doesNotMatch(service, /communicationChannelFanout|fanOutNotificationChannels/);
});
