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
  const service = read("backend/lib/communicationsMessagesService.js");
  const attachments = read("backend/lib/communicationsAttachments.js");
  const schema = read("backend/db/communicationsMessagesSchema.js");
  const server = read("backend/server.js");
  const rbac = read("backend/services/rbacService.js");
  const webApi = read("web/src/lib/clientsApi.ts") + read("web/src/lib/messagesApi.ts");
  const webPage = read("web/src/pages/MessagesConversationsPage.tsx");
  const placeholders = read("web/src/pages/parametres/SettingsPlaceholders.tsx");
  const httpTest = read("backend/lib/communicationsC2.http.pg.test.js");
  const financeRbac = read("backend/lib/financeRbacRouteMatrix.js");

  assert.match(schema, /communication_attachments/);
  assert.match(schema, /entity_type/);
  assert.match(service, /assertCanMessageRecipient/);
  assert.match(service, /requireActiveParticipant/);
  assert.match(service, /senderName/);
  assert.match(service, /attachmentIds/);
  assert.doesNotMatch(service, /payload\.senderUserId/);
  assert.match(attachments, /application\/pdf/);
  assert.match(attachments, /MAX_ATTACHMENT_BYTES/);
  assert.match(server, /GET \/api\/backoffice\/conversations/);
  assert.match(server, /POST \/api\/backoffice\/conversations\/:conversationId\/messages/);
  assert.match(server, /communications\/attachments/);
  assert.match(rbac, /GET \/api\/backoffice\/conversations/);
  assert.doesNotMatch(financeRbac, /backoffice\/messages/);
  assert.match(webApi, /Idempotency-Key/);
  assert.match(webPage, /MessagesConversationsPage/);
  assert.doesNotMatch(webPage, /dangerouslySetInnerHTML/);
  assert.match(placeholders, /ComingSoonState/);
  assert.match(httpTest, /C2-01 Teacher A non participant/);
  assert.match(httpTest, /C2-02 Teacher A2/);
  assert.match(httpTest, /C2-03 trois messages/);
  assert.match(httpTest, /C2-04 pas de status global read/);
  assert.match(httpTest, /C2-05 conversation visible sans studentIds/);
  assert.match(httpTest, /C2-07 Parent A télécharge 200/);
  assert.match(httpTest, /C2-08 attachments\[2\]/);
  assert.match(httpTest, /C2-09 même clé/);
  assert.match(httpTest, /C2-10 CREATE révoqué/);
  assert.match(httpTest, /C2-11 texte brut/);
  assert.match(httpTest, /C2-12 aucune mutation/);
  console.log("verify-communications-c2: source guards OK");
}

function main() {
  sourceGuards();
  run(process.execPath, ["backend/lib/communicationsAttachments.test.js"], "communicationsAttachments unit");
  run(process.execPath, ["backend/lib/clientsSecurity.test.js"], "clientsSecurity");
  assert.ok(String(process.env.DATABASE_URL ?? "").trim(), "DATABASE_URL requis pour COM-C2");
  run(process.execPath, ["backend/lib/communicationsC2.http.pg.test.js"], "parcours HTTP PostgreSQL COM-C2");
  console.log("verify-communications-c2: GO — PostgreSQL réel inclus");
}

main();
