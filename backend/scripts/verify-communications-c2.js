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
  const webApi =
    read("web/src/lib/clientsApi.ts") +
    read("web/src/lib/messagesApi.ts") +
    read("web/src/lib/communicationSchoolScope.ts");
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
  assert.match(server, /GET \/api\/backoffice\/messages\/recipients/);
  assert.match(rbac, /GET \/api\/backoffice\/messages\/recipients/);
  assert.match(attachments, /SOMAFRIK_COMMUNICATION_STORAGE/);
  assert.match(attachments, /isProductionEnv/);
  assert.match(attachments, /communicationStorageReadiness/);
  assert.match(attachments, /isEphemeralStoragePath/);
  assert.match(attachments, /removeStoredAttachment/);
  assert.match(server, /probeCommunicationStorageWritable/);
  assert.match(server, /attachments/);
  assert.match(service, /listAuthorizedRecipients/);
  assert.match(service, /effectiveSchoolCode/);
  assert.match(service, /Établissement requis \(effectiveSchoolCode\)/);
  assert.match(service, /function canBypassParticipation\(\) \{\s*return false;/);
  assert.match(service, /async function markMessageRead\(store, messageId, principal, auditMeta, query/);
  assert.match(service, /message\.school_id !== school\.id/);
  assert.match(server, /markClientsMessageRead\([\s\S]{0,180}req\.query/);
  assert.match(webApi, /withCommunicationSchoolScope/);
  assert.match(webApi, /effectiveSchoolCode/);
  assert.match(webApi, /messages\/recipients/);
  assert.doesNotMatch(webPage, /clientsApi\.listUsers/);
  assert.match(httpTest, /C2-13 Parent voit staff/);
  assert.match(httpTest, /C2-14 Superadmin \* sans école/);
  assert.match(httpTest, /C2-14 Superadmin mark-read sans école/);
  assert.match(httpTest, /C2-13 READ révoqué destinataires/);
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
  const mobileScreen = read("Mobile/src/screens/MessagesScreen.tsx");
  const mobilePayload = read("Mobile/src/lib/messageAttachments.ts");
  const mobileScope = read("Mobile/src/lib/communicationSchoolScope.ts");
  assert.match(mobileScreen, /getMessageRecipients/);
  assert.match(mobileScreen, /uploadCommunicationAttachment/);
  assert.match(mobileScreen, /attachmentIds/);
  assert.match(mobileScreen, /withCommunicationSchoolPayload/);
  assert.doesNotMatch(mobileScreen, /getCanonicalContacts/);
  assert.match(mobilePayload, /buildMessagePayload/);
  assert.match(mobilePayload, /client_attachment_url_forbidden/);
  assert.match(mobileScope, /withCommunicationSchoolScope/);
  assert.match(mobileScope, /effectiveSchoolCode/);
  console.log("verify-communications-c2: source guards OK");
}

function main() {
  sourceGuards();
  run(process.execPath, ["backend/lib/communicationsAttachments.test.js"], "communicationsAttachments unit");
  run(process.execPath, ["backend/lib/clientsSecurity.test.js"], "clientsSecurity");
  run("npx", ["--yes", "tsx", "Mobile/src/lib/messageAttachments.test.ts"], "messageAttachments payload");
  run("npx", ["--yes", "tsx", "Mobile/src/lib/communicationSchoolScope.test.ts"], "communicationSchoolScope");
  assert.ok(String(process.env.DATABASE_URL ?? "").trim(), "DATABASE_URL requis pour COM-C2");
  run(process.execPath, ["backend/lib/communicationsC2.http.pg.test.js"], "parcours HTTP PostgreSQL COM-C2");
  console.log("verify-communications-c2: GO — PostgreSQL réel inclus");
}

main();
