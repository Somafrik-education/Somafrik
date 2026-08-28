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
  const service = read("backend/lib/communicationsAnnouncementsService.js");
  const messages = read("backend/lib/communicationsMessagesService.js");
  const schema = read("backend/db/communicationsAnnouncementsSchema.js");
  const migration = read("backend/db/migrations/20260828_communications_c3_announcements.sql");
  const server = read("backend/server.js");
  const rbac = read("backend/services/rbacService.js");
  const catalog = read("backend/lib/functionalModulesCatalog.js");
  const webApi = read("web/src/lib/announcementsApi.ts") + read("web/src/lib/announcementsRead.ts");
  const webPage = read("web/src/pages/AnnouncementsPage.tsx");
  const placeholders = read("web/src/pages/parametres/SettingsPlaceholders.tsx");
  const httpTest = read("backend/lib/communicationsC3.http.pg.test.js");
  const financeRbac = read("backend/lib/financeRbacRouteMatrix.js");
  const pgStore = read("backend/db/clientsPgStore.js");

  assert.match(schema, /announcement_recipients/);
  assert.match(schema, /announcement_reads/);
  assert.match(migration, /UNIQUE|PRIMARY KEY \(announcement_id, user_id\)/);
  assert.match(service, /insertAnnouncementRecipients/);
  assert.match(service, /Audience immuable après publication/);
  assert.doesNotMatch(service, /payload\.createdByUserId/);
  assert.match(service, /requireSchool/);
  assert.match(service, /hydrateAnnouncementWithTx/);
  assert.doesNotMatch(service, /return getAnnouncement\(store/);
  assert.match(messages, /Établissement requis \(effectiveSchoolCode\)/);
  assert.match(messages, /assertEntityTypeDownloadAccess/);
  assert.match(rbac, /GET \/api\/backoffice\/messages\/attachments\/:attachmentId/);
  assert.match(rbac, /GET \/api\/backoffice\/announcements\/attachments\/:attachmentId/);
  assert.match(server, /GET \/api\/backoffice\/announcements\/unread-count/);
  assert.match(server, /GET \/api\/backoffice\/announcements\/audience-options/);
  assert.match(server, /PATCH \/api\/backoffice\/announcements\/:announcementId\/read/);
  assert.match(server, /POST \/api\/backoffice\/announcements\/attachments/);
  assert.match(server, /withIdempotency/);
  assert.match(rbac, /Announcements:READ/);
  assert.match(rbac, /Announcements:CREATE/);
  assert.match(rbac, /Announcements:UPDATE/);
  assert.match(catalog, /moduleKey: "announcements"/);
  assert.match(webApi, /Idempotency-Key/);
  assert.match(webApi, /withCommunicationSchoolScope/);
  assert.match(webApi, /unread-count/);
  assert.doesNotMatch(webApi, /localStorage/);
  assert.match(webPage, /announcementsApi\.markRead/);
  assert.doesNotMatch(webPage, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(webPage, /localStorage/);
  assert.match(placeholders, /ComingSoonState/);
  assert.doesNotMatch(financeRbac, /backoffice\/announcements/);
  assert.match(pgStore, /entity_type = 'announcement'/);
  assert.match(pgStore, /entity_type = 'message'/);
  assert.match(httpTest, /C3-01/);
  assert.match(httpTest, /C3-02 Parent A2/);
  assert.match(httpTest, /C3-03 Teacher A2/);
  assert.match(httpTest, /C3-04 Student A/);
  assert.match(httpTest, /C3-05 Parent A conserve/);
  assert.match(httpTest, /C3-06 announcement_reads Parent = 1/);
  assert.match(httpTest, /C3-07 badge identique/);
  assert.match(httpTest, /C3-08 publishedAt ISO/);
  assert.match(httpTest, /C3-09 Parent A télécharge 200/);
  assert.match(httpTest, /C3-10 attachments\[2\]/);
  assert.match(httpTest, /C3-11 même clé/);
  assert.match(httpTest, /C3-12 CREATE révoqué/);
  assert.match(httpTest, /C3-13 aucune mutation/);
  assert.match(httpTest, /C3-14 Superadmin \* sans école/);
  assert.match(httpTest, /C3-15 destinataire ne voit pas legacy/);
  assert.match(httpTest, /C3-16 titre texte brut/);
  assert.match(httpTest, /P1-017/);
  assert.match(httpTest, /P1-018/);

  const mobileScreen = read("Mobile/src/screens/AnnouncementsScreen.tsx");
  const mobileRead = read("Mobile/src/lib/announcementsRead.ts");
  const mobileControls = read("Mobile/src/components/AnnouncementMutationControls.tsx");
  const topbar = read("web/src/components/layout/Topbar.tsx");
  assert.match(mobileScreen, /markCanonicalAnnouncementRead/);
  assert.doesNotMatch(mobileScreen, /localStorage/);
  assert.doesNotMatch(mobileRead, /localStorage/);
  assert.match(mobileControls, /idempotencyKey|Idempotency|randomUUID/);
  assert.match(mobileControls, /recipientKinds|selectedKinds/);
  assert.match(topbar, /useAnnouncementsUnreadCount/);
  console.log("verify-communications-c3: source guards OK");
}

function main() {
  sourceGuards();
  run(process.execPath, ["backend/lib/communicationsAnnouncements.unit.test.js"], "announcements unit");
  run(process.execPath, ["backend/lib/communicationsAttachments.test.js"], "communicationsAttachments unit");
  run("npx", ["--yes", "tsx", "Mobile/src/lib/communicationSchoolScope.test.ts"], "communicationSchoolScope");
  run("npx", ["--yes", "tsx", "Mobile/src/lib/mobileCtaRbacAlignment.test.ts"], "mobileCtaRbacAlignment");
  run("npx", ["--yes", "tsx", "Mobile/src/lib/announcementsC3.test.ts"], "mobile announcements C3");
  run("npm", ["--prefix", "web", "run", "test", "--", "src/lib/announcementsC3.test.ts"], "web announcements C3");
  assert.ok(String(process.env.DATABASE_URL ?? "").trim(), "DATABASE_URL requis pour COM-C3");
  run(process.execPath, ["backend/lib/communicationsC3.http.pg.test.js"], "parcours HTTP PostgreSQL COM-C3");
  console.log("verify-communications-c3: GO — PostgreSQL réel inclus");
}

main();
