"use strict";

/**
 * COM-C1 — Gate audit Communication (messages / annonces / notifications).
 */

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
  const service = read("backend/lib/clientsService.js");
  const server = read("backend/server.js");
  const schema = read("backend/db/clientsSchema.js");
  const placeholders = read("web/src/pages/parametres/SettingsPlaceholders.tsx");
  const outbox = read("Mobile/src/lib/outbox.ts");
  const httpTest = read("backend/lib/communicationsReadiness.http.pg.test.js");
  const rbac = read("backend/services/rbacService.js");
  const financeRbac = read("backend/lib/financeRbacRouteMatrix.js");

  assert.match(schema, /CREATE TABLE IF NOT EXISTS school_conversations/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS school_messages/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS school_message_reads/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS school_conversation_participants/);

  const sendMessage = service.slice(service.indexOf("async function sendMessage"), service.indexOf("async function markMessageRead"));
  assert.match(sendMessage, /senderUserId = asTrimmed\(principal\?\.sub/);
  assert.doesNotMatch(sendMessage, /payload\.senderUserId/);
  assert.match(sendMessage, /ignoreClientScope/);
  assert.match(sendMessage, /assertParticipantsInSchool/);

  assert.match(server, /routeKey: "POST \/api\/backoffice\/messages"/);
  assert.match(rbac, /GET \/api\/backoffice\/messages/);
  assert.match(rbac, /POST \/api\/backoffice\/announcements/);
  assert.doesNotMatch(financeRbac, /backoffice\/messages/);
  assert.doesNotMatch(financeRbac, /backoffice\/announcements/);

  assert.match(placeholders, /Paramètres Notifications/);
  assert.match(placeholders, /ComingSoonState/);
  assert.match(outbox, /OUTBOX_ALLOWED_DOMAINS = \["messages"/);

  assert.match(httpTest, /COM-C1 E2E1 Parent A voit le message/);
  assert.match(httpTest, /COM-C1 E2E3 aucune mutation dans conversation A/);
  assert.match(httpTest, /COM-C1 E2E4 école B ne voit jamais l'annonce A/);
  assert.match(httpTest, /COM-C1 E2E6 NOT_IMPLEMENTED/);
  assert.match(httpTest, /Idempotency-Key/);
  assert.match(httpTest, /sender vient du principal/);

  console.log("verify-communications-e2e: source guards COM-C1 OK");
}

function main() {
  sourceGuards();
  run(
    process.execPath,
    ["backend/lib/clientsSecurity.test.js"],
    "clientsSecurity (participants hors tenant) a échoué",
  );
  assert.ok(String(process.env.DATABASE_URL ?? "").trim(), "DATABASE_URL requis pour le parcours PostgreSQL COM-C1");
  run(process.execPath, ["backend/lib/communicationsReadiness.http.pg.test.js"], "parcours HTTP PostgreSQL COM-C1 a échoué");
  console.log("verify-communications-e2e: GO — PostgreSQL réel inclus");
}

main();
