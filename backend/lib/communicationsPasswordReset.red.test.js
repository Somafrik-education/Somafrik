"use strict";

/**
 * PR C — reset mot de passe + EMAIL transactionnel.
 * 03A/D/G/H doivent rester verts : enqueue durable dans la txn, pas de SMTP inline,
 * provisoire vide rejeté, pas de C4 IN_APP.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function sliceFrom(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  assert.ok(start >= 0, `bloc introuvable: ${startNeedle}`);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  return src.slice(start, end >= 0 ? end : start + 4500);
}

function resetHandler() {
  return sliceFrom(
    read("backend/server.js"),
    'app.post("/api/users/:id/reset-password"',
    'app.get("/api/payments"',
  );
}

function resetTransactionBlock() {
  const handler = resetHandler();
  return sliceFrom(handler, "repository.withTransaction", "await auditService.record");
}

test("GREEN-COM-03B — aucun SMTP dans la transaction de reset (échec mailer ≠ rollback)", () => {
  const tx = resetTransactionBlock();
  assert.match(tx, /resetUserPassword/);
  assert.doesNotMatch(tx, /sendMail|nodemailer|createSmtpTransport|notifyTrialAccessRequest|setImmediate/);
});

test("GREEN-COM-03C — la transaction de reset révoque les sessions", () => {
  const tx = resetTransactionBlock();
  assert.match(tx, /revokeAllSessionsForUser/);
  assert.match(tx, /password_reset/);
});

test("GREEN-COM-03E — reset est scoped usersHttpPrincipal + assertUsersTargetAccess", () => {
  const handler = resetHandler();
  assert.match(handler, /usersHttpPrincipal/);
  assert.match(handler, /assertUsersReadable/);
  assert.match(handler, /assertUsersTargetAccess/);
  assert.match(handler, /filterUsersRows/);
  assert.doesNotMatch(handler, /tenantScopeService\.filterRows\(canonicalUsers, req\.principal\)/);
});

test("GREEN-COM-03F — l'audit reset n'embarque pas le mot de passe provisoire", () => {
  const handler = resetHandler();
  const audit = sliceFrom(handler, "auditService.record", "res.json");
  assert.match(audit, /reset_user_password/);
  assert.doesNotMatch(audit, /temporaryPassword/);
  assert.doesNotMatch(handler, /console\.(log|info|warn|debug|error)\([^\)]*temporaryPassword/);
});

test("GREEN-COM-03-c4 — reset n'appelle pas processOneEvent / outbox C4 IN_APP", () => {
  const handler = resetHandler();
  assert.doesNotMatch(handler, /processOneEvent|drainOutbox|fanOutNotificationChannels|communication_event_outbox/);
  assert.doesNotMatch(handler, /brevo|@getbrevo|sendgrid|twilio/i);
});

test("RED-COM-03A — après persist reset, une notification EMAIL est programmée", () => {
  const handler = resetHandler();
  assert.match(
    handler,
    /ensureDelivery|enqueueChannelDeliveries|notifyPasswordReset|passwordResetNotification|auth\.password\.reset/,
    "POST /api/users/:id/reset-password persiste le secret et s'arrête : aucune commande EMAIL n'est programmée",
  );
});

test("RED-COM-03D — l'intention d'email est écrite dans la même transaction que le reset", () => {
  const tx = resetTransactionBlock();
  assert.match(
    tx,
    /ensureDelivery|communication_channel_deliveries|passwordResetNotification/,
    "COMMIT reset sans ligne de livraison durable : un crash post-COMMIT perd silencieusement l'email",
  );
});

test("RED-COM-03G — delivery_key unique pour un reset logique (pas de double email au retry)", () => {
  const handler = resetHandler();
  assert.match(
    handler,
    /delivery_key|deliveryKey|Idempotency-Key|auth\.password\.reset/,
    "le reset n'a ni clé d'idempotence HTTP ni delivery_key : un retry technique pourrait multi-envoyer au GREEN naïf",
  );
});

test("RED-COM-03H — un mot de passe provisoire vide est rejeté", () => {
  const handler = resetHandler();
  assert.match(
    handler,
    /if\s*\(\s*!temporaryPassword\s*\)/,
    "validateAccountSecret('') retourne null : l'API accepte un reset vide et peut nuller password_hash",
  );
});
