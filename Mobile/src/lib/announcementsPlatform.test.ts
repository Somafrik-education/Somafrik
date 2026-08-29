import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const screenSrc = fs.readFileSync(path.join(ROOT, "src/screens/AnnouncementsScreen.tsx"), "utf8");
assert.doesNotMatch(screenSrc, /localStorage/);
assert.doesNotMatch(screenSrc, /AsyncStorage/);
assert.match(screenSrc, /markCanonicalAnnouncementRead/);
assert.match(screenSrc, /Annonce Somafrik|originLabel|systemBroadcast/);

const controlsSrc = fs.readFileSync(path.join(ROOT, "src/components/AnnouncementMutationControls.tsx"), "utf8");
assert.match(controlsSrc, /createPlatformAnnouncement/);
assert.match(controlsSrc, /Annonce administrative/);
assert.match(controlsSrc, /Tous les utilisateurs Somafrik/);
assert.match(controlsSrc, /recipientKinds/);
assert.match(controlsSrc, /withCommunicationSchoolPayload/);
assert.doesNotMatch(controlsSrc, /AsyncStorage/);

const readSrc = fs.readFileSync(path.join(ROOT, "src/lib/announcementsRead.ts"), "utf8");
assert.doesNotMatch(readSrc, /localStorage/);
assert.doesNotMatch(readSrc, /AsyncStorage/);

const apiSrc = fs.readFileSync(path.join(ROOT, "src/services/api.ts"), "utf8");
assert.match(apiSrc, /platform-announcements/);
assert.match(apiSrc, /createPlatformAnnouncement/);

const hydrateSrc = fs.readFileSync(path.join(ROOT, "src/services/domainHydrationApi.ts"), "utf8");
assert.match(hydrateSrc, /platform-announcements/);
assert.match(hydrateSrc, /source === "platform"/);

console.log("OK Mobile announcementsPlatform.test.ts");
