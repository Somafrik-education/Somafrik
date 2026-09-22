/**
 * Lot C — RED-06 Mobile Messages + Annonces.
 * Pagination nextCursor sans doublon, perte, ni fuite tenant.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withCommunicationSchoolScope } from "./communicationSchoolScope";
import {
  announcementRowKey,
  mergeAnnouncementsByKey,
  mergeRowsById,
  readNextCursor,
  withListCursor,
} from "./communicationPagination";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => fs.readFileSync(path.join(ROOT, "src", relative), "utf8");

const NEXT_CURSOR = "2026-09-09T10:00:00.000Z|00000000-0000-4000-8000-000000000050";

const messagesScreen = read("screens/MessagesScreen.tsx");
const announcementsScreen = read("screens/AnnouncementsScreen.tsx");
const hydration = read("services/domainHydrationApi.ts");

assert.match(messagesScreen, /nextCursor/, "Messages Mobile ignore nextCursor");
assert.match(messagesScreen, /getCanonicalConversationsPage/);
assert.match(messagesScreen, /messages-load-more/);
assert.match(messagesScreen, /mergeRowsById/);
assert.match(messagesScreen, /activeSchoolCode/);

assert.match(announcementsScreen, /nextCursor/, "Annonces Mobile ignore nextCursor");
assert.match(announcementsScreen, /getCanonicalAnnouncementsPage/);
assert.match(announcementsScreen, /announcements-load-more/);
assert.match(announcementsScreen, /mergeAnnouncementsByKey/);
assert.match(announcementsScreen, /includeSchool: Boolean\(pendingSchoolCursor\)/);
assert.match(announcementsScreen, /getCanonicalAnnouncementById/);

assert.match(hydration, /getCanonicalConversationsPage/);
assert.match(hydration, /getCanonicalAnnouncementsPage/);
assert.match(hydration, /withListCursor\("\/backoffice\/conversations"/);
assert.match(hydration, /withListCursor\("\/backoffice\/announcements"/);
assert.match(hydration, /withListCursor\("\/backoffice\/platform-announcements"/);
assert.match(hydration, /withCommunicationSchoolScope\(schoolPath, scope\)/);
assert.match(hydration, /scopedMessagesPath\(path, schoolCode\)/);
assert.doesNotMatch(hydration, /withCommunicationSchoolScope\(platformPath/);
assert.doesNotMatch(hydration, /\.catch\(\s*\(\)\s*=>\s*\[\s*\]\s*\)/);

assert.equal(withListCursor("/backoffice/conversations", NEXT_CURSOR), `/backoffice/conversations?cursor=${encodeURIComponent(NEXT_CURSOR)}`);
assert.equal(
  withCommunicationSchoolScope(withListCursor("/backoffice/conversations", NEXT_CURSOR), "SCH-001"),
  `/backoffice/conversations?cursor=${encodeURIComponent(NEXT_CURSOR)}&effectiveSchoolCode=SCH-001`,
);
assert.equal(
  withCommunicationSchoolScope(withListCursor("/backoffice/announcements", NEXT_CURSOR), "SCH-001"),
  `/backoffice/announcements?cursor=${encodeURIComponent(NEXT_CURSOR)}&effectiveSchoolCode=SCH-001`,
);
assert.equal(withListCursor("/backoffice/platform-announcements", NEXT_CURSOR), `/backoffice/platform-announcements?cursor=${encodeURIComponent(NEXT_CURSOR)}`);
assert.equal(
  withCommunicationSchoolScope(withListCursor("/backoffice/announcements", NEXT_CURSOR), "SCH-COM-B").includes("SCH-COM-A"),
  false,
);
assert.equal(readNextCursor({ items: [], nextCursor: NEXT_CURSOR }), NEXT_CURSOR);
assert.equal(readNextCursor({ items: [], nextCursor: "  " }), null);

const firstPage = Array.from({ length: 50 }, (_, index) => ({ id: `conv-${index + 1}` }));
const secondPage = [{ id: "conv-1" }, { id: "conv-51" }];
const mergedConversations = mergeRowsById(firstPage, secondPage);
assert.equal(mergedConversations.filter((row) => row.id === "conv-1").length, 1);
assert.ok(mergedConversations.some((row) => row.id === "conv-51"));
assert.equal(mergedConversations.length, 51);

const schoolPage = [{ id: "ann-1", source: "school" as const }, { id: "ann-2", source: "school" as const }];
const extraPage = [
  { id: "ann-1", source: "school" as const },
  { id: "ann-1", source: "platform" as const },
  { id: "ann-3", source: "school" as const },
];
const mergedAnnouncements = mergeAnnouncementsByKey(schoolPage, extraPage);
assert.equal(mergedAnnouncements.filter((row) => announcementRowKey(row) === "school-ann-1").length, 1);
assert.ok(mergedAnnouncements.some((row) => announcementRowKey(row) === "platform-ann-1"));
assert.ok(mergedAnnouncements.some((row) => row.id === "ann-3"));
assert.equal(mergedAnnouncements.length, 4);

console.log("OK Mobile communicationPagination.lotc.test.ts");
