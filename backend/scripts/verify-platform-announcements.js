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
  const schema = read("backend/db/platformAnnouncementsSchema.js");
  const migration = read("backend/db/migrations/20260829_platform_announcements.sql");
  const service = read("backend/lib/platformAnnouncementsService.js");
  const c3Service = read("backend/lib/communicationsAnnouncementsService.js");
  const c3Schema = read("backend/db/communicationsAnnouncementsSchema.js");
  const bootstrap = read("backend/db/clientsCanonicalBootstrap.js");
  const server = read("backend/server.js");
  const rbac = read("backend/services/rbacService.js");
  const pgStore = read("backend/db/clientsPgStore.js");
  const attachments = read("backend/lib/communicationsAttachments.js");
  const webPage = read("web/src/pages/AnnouncementsPage.tsx");
  const webApi = read("web/src/lib/platformAnnouncementsApi.ts");
  const webRead = read("web/src/lib/announcementsRead.ts");
  const mobileScreen = read("Mobile/src/screens/AnnouncementsScreen.tsx");
  const mobileControls = read("Mobile/src/components/AnnouncementMutationControls.tsx");
  const mobileRead = read("Mobile/src/lib/announcementsRead.ts");
  const hydrateSrc = read("Mobile/src/services/domainHydrationApi.ts");
  const httpTest = read("backend/lib/platformAnnouncements.http.pg.test.js");
  const c3Http = read("backend/lib/communicationsC3.http.pg.test.js");

  assert.match(schema, /CREATE TABLE IF NOT EXISTS platform_announcements/);
  assert.match(schema, /platform_announcement_recipients/);
  assert.match(schema, /platform_announcement_reads/);
  assert.match(schema, /platform_announcement_attachments/);
  assert.match(schema, /PRIMARY KEY \(announcement_id, user_id\)/);
  assert.match(schema, /announcement_type = 'administrative'/);
  assert.match(schema, /announcement_type = 'system' AND audience_key = 'all_active_users'/);
  assert.doesNotMatch(schema, /school_id UUID NOT NULL/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS platform_announcements/);
  assert.match(migration, /platform_announcement_attachments/);

  assert.match(bootstrap, /applyPlatformAnnouncementsSchema/);
  const bootstrapFn = bootstrap.indexOf("async function ensureClientsCanonicalBootstrap");
  const c4Call = bootstrap.indexOf("applyCommunicationsC4Schema", bootstrapFn);
  const platformCall = bootstrap.indexOf("applyPlatformAnnouncementsSchema", bootstrapFn);
  const linkingCall = bootstrap.indexOf("ensureParentLinkingConstraints", bootstrapFn);
  assert.ok(c4Call > bootstrapFn && platformCall > c4Call && linkingCall > platformCall);

  assert.doesNotMatch(service, /requireSchool\s*\(/);
  assert.doesNotMatch(service, /effectiveSchoolCode/);
  assert.doesNotMatch(service, /payload\.createdByUserId/);
  assert.match(service, /requireLiveSuperAdmin/);
  assert.match(service, /snapshotPlatformAnnouncementRecipients/);
  assert.match(service, /assertNoClientRecipients/);
  assert.doesNotMatch(service, /listPlatformAnnouncementRecipients/);
  assert.doesNotMatch(service, /insertPlatformAnnouncementRecipients\(/);
  assert.match(service, /SYSTEM_SENDER_DISPLAY_NAME = "Somafrik"/);
  assert.match(service, /persistPlatformAttachmentBytes/);
  assert.match(service, /country_admins/);
  assert.match(service, /school_admins/);
  assert.match(service, /all_admins/);
  assert.match(service, /all_active_users/);

  assert.match(c3Service, /requireSchool/);
  assert.match(c3Schema, /school_id UUID NOT NULL/);
  assert.match(c3Http, /C3-01/);
  assert.match(c3Http, /C3-16 titre texte brut/);

  assert.match(pgStore, /snapshotPlatformAnnouncementRecipients/);
  assert.match(pgStore, /INSERT INTO platform_announcement_recipients/);
  assert.match(pgStore, /ON CONFLICT \(announcement_id, user_id\) DO NOTHING/);
  assert.match(pgStore, /all_active_users/);
  assert.match(pgStore, /EXISTS \(/);
  assert.match(pgStore, /ur\.status = 'active'/);
  assert.match(pgStore, /ur\.revoked_at IS NULL/);
  const snapshotStart = pgStore.indexOf("async snapshotPlatformAnnouncementRecipients");
  const snapshotEnd = pgStore.indexOf("async insertPlatformAnnouncement(", snapshotStart);
  assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart, "bloc snapshot plateforme");
  const snapshotBlock = pgStore.slice(snapshotStart, snapshotEnd);
  assert.match(snapshotBlock, /INSERT INTO platform_announcement_recipients/);
  assert.match(snapshotBlock, /SELECT/);
  assert.doesNotMatch(snapshotBlock, /for \(const row of rows\)/);
  assert.match(attachments, /platform-announcements/);
  assert.match(attachments, /persistPlatformAttachmentBytes/);

  assert.match(server, /GET \/api\/backoffice\/platform-announcements\/unread-count/);
  assert.match(server, /POST \/api\/backoffice\/platform-announcements/);
  assert.match(server, /PATCH \/api\/backoffice\/platform-announcements\/:announcementId\/read/);
  assert.match(server, /POST \/api\/backoffice\/platform-announcements\/:announcementId\/archive/);
  assert.match(server, /POST \/api\/backoffice\/platform-announcements\/attachments/);
  assert.match(rbac, /POST \/api\/backoffice\/platform-announcements": \["ALL_PRIVILEGES"\]/);
  assert.match(rbac, /GET \/api\/backoffice\/platform-announcements/);

  assert.match(webPage, /isSuperAdminRole/);
  assert.match(webPage, /Annonce administrative/);
  assert.match(webPage, /Annonce système Somafrik/);
  assert.match(webPage, /Administrateurs pays/);
  assert.match(webPage, /Tous les utilisateurs Somafrik/);
  assert.match(webPage, /tous les utilisateurs\s+actifs de Somafrik/i);
  assert.match(webPage, /!isGlobalSuperadmin && schoolScope/);
  assert.match(webPage, /announcementsApi\s*\n\s*\.audienceOptions/);
  assert.match(webPage, /announcementsApi\.markRead/);
  assert.match(webPage, /platformAnnouncementsApi\.publish/);
  assert.doesNotMatch(webPage, /localStorage/);
  assert.doesNotMatch(webApi, /effectiveSchoolCode/);
  assert.doesNotMatch(webApi, /localStorage/);
  assert.match(webRead, /platformAnnouncementsApi\.unreadCount/);
  assert.doesNotMatch(webRead, /localStorage/);

  assert.match(mobileControls, /createPlatformAnnouncement/);
  assert.match(mobileControls, /Annonce administrative/);
  assert.match(mobileControls, /recipientKinds/);
  assert.match(mobileControls, /withCommunicationSchoolPayload/);
  assert.doesNotMatch(mobileControls, /AsyncStorage/);
  assert.doesNotMatch(mobileScreen, /localStorage/);
  assert.doesNotMatch(mobileScreen, /AsyncStorage/);
  assert.doesNotMatch(mobileRead, /localStorage/);
  assert.doesNotMatch(mobileRead, /AsyncStorage/);
  assert.match(hydrateSrc, /platform-announcements/);
  assert.doesNotMatch(hydrateSrc, /\.catch\(\s*\(\)\s*=>\s*\[\s*\]\s*\)/);
  assert.doesNotMatch(hydrateSrc.replace(/\s+/g, " "), /\.catch\(\(\) => \(\{ count: 0 \}\)\)/);
  assert.doesNotMatch(webPage.replace(/\s+/g, " "), /\.catch\(\(\) => \(\{ items: \[\]/);
  assert.doesNotMatch(webRead.replace(/\s+/g, " "), /\.catch\(\(\) => \(\{ count: 0 \}\)\)/);
  assert.doesNotMatch(mobileRead, /\.catch\([\s\S]*setCount\(0\)/);
  const mobileApi = read("Mobile/src/services/api.ts");
  assert.doesNotMatch(mobileApi.replace(/\s+/g, " "), /\.catch\(\(\) => \(\{ count: 0 \}\)\)/);

  assert.match(httpTest, /PA-01/);
  assert.match(httpTest, /PA-02/);
  assert.match(httpTest, /PA-03/);
  assert.match(httpTest, /PA-04/);
  assert.match(httpTest, /PA-05/);
  assert.match(httpTest, /PA-06/);
  assert.match(httpTest, /PA-07/);
  assert.match(httpTest, /PA-08/);
  assert.match(httpTest, /PA-09/);
  assert.match(httpTest, /PA-10/);
  assert.match(httpTest, /PA-11/);
  assert.match(httpTest, /PA-12/);
  assert.match(httpTest, /PA-13/);
  assert.match(httpTest, /PA-14/);
  assert.match(httpTest, /recipient_insert_statement/);
  assert.match(httpTest, /REVOKED_U/);
  console.log("verify-platform-announcements: source guards OK");
}

function main() {
  sourceGuards();
  run(process.execPath, ["backend/lib/platformAnnouncements.unit.test.js"], "platform announcements unit");
  run(process.execPath, ["backend/lib/communicationsAttachments.test.js"], "communicationsAttachments unit");
  run(process.execPath, ["backend/db/clientsCanonicalBootstrap.test.js"], "clientsCanonicalBootstrap");
  run("npx", ["--yes", "tsx", "Mobile/src/lib/announcementsPlatform.test.ts"], "mobile platform announcements");
  run("npx", ["--yes", "tsx", "Mobile/src/lib/announcementsC3.test.ts"], "mobile announcements C3");
  run("npm", ["--prefix", "web", "run", "test", "--", "src/lib/announcementsPlatform.test.ts", "src/lib/announcementsC3.test.ts"], "web announcements platform+C3");
  assert.ok(String(process.env.DATABASE_URL ?? "").trim(), "DATABASE_URL requis pour platform-announcements");
  run(process.execPath, ["backend/lib/platformAnnouncements.http.pg.test.js"], "parcours HTTP PostgreSQL ANN-PLATFORM-1");
  console.log("verify-platform-announcements: GO — PostgreSQL réel inclus");
}

main();
