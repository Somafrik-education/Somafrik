import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canArchiveAnnouncement } from "./mobileCtaRbacAlignment";
import { attachCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import { canReadView } from "../domain/security/permissions";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function liveSession(permissions: string[]) {
  return attachCanonicalRoleIdentity({
    role: "principal",
    permissions,
    user: {
      id: "c3-user",
      name: "C3",
      schoolCode: "SCH-COM-A",
      role: "Directeur",
      roleKeys: ["PRINCIPAL"],
      permissions,
    },
  });
}

assert.equal(canArchiveAnnouncement(liveSession(["Announcements:UPDATE"])), true);
assert.equal(canArchiveAnnouncement(liveSession(["Announcements:READ"])), false);
assert.equal(canArchiveAnnouncement(liveSession(["Notifications:UPDATE"])), false);
assert.equal(canReadView(liveSession(["Notifications:READ"]), "Announcements"), false);
assert.equal(canReadView(liveSession(["Announcements:READ"]), "Announcements"), true);

const readSrc = fs.readFileSync(path.join(ROOT, "src/lib/announcementsRead.ts"), "utf8");
assert.doesNotMatch(readSrc, /localStorage/);
assert.match(readSrc, /getAnnouncementsUnreadCount/);

const screenSrc = fs.readFileSync(path.join(ROOT, "src/screens/AnnouncementsScreen.tsx"), "utf8");
assert.doesNotMatch(screenSrc, /localStorage/);
assert.match(screenSrc, /markCanonicalAnnouncementRead/);
assert.match(screenSrc, /formatDisplayDate/);
assert.match(screenSrc, /attachments/);

const controlsSrc = fs.readFileSync(path.join(ROOT, "src/components/AnnouncementMutationControls.tsx"), "utf8");
assert.match(controlsSrc, /idempotencyKey/);
assert.match(controlsSrc, /recipientKinds/);
assert.match(controlsSrc, /withCommunicationSchoolPayload/);
assert.match(controlsSrc, /uploadAnnouncementAttachment/);

const apiSrc = fs.readFileSync(path.join(ROOT, "src/services/api.ts"), "utf8");
assert.match(apiSrc, /idempotencyKey: options\?\.idempotencyKey/);
assert.match(apiSrc, /announcements\/attachments/);
const httpSrc = fs.readFileSync(path.join(ROOT, "src/services/httpClient.ts"), "utf8");
assert.match(httpSrc, /Idempotency-Key/);

console.log("OK Mobile announcementsC3.test.ts");
