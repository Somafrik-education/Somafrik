/**
 * UX Communication Web — liste compacte, détails/actions après ouverture ou dépliage.
 * Analogue Mobile pariteCommunicationUx.test.ts / Finance pariteL1FinanceUx.test.ts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(webRoot, relative), "utf8");

const expandable = read("components/communications/ExpandableCommunicationCard.tsx");
const notifications = read("components/communications/InternalNotificationsCenter.tsx");
const announcements = read("pages/AnnouncementsPage.tsx");
const messages = read("pages/MessagesConversationsPage.tsx");

assert.match(expandable, /defaultExpanded = false/);
assert.match(expandable, /aria-expanded=\{expanded\}/);
assert.match(expandable, /les détails/);
assert.match(expandable, /expanded \? <div className="space-y-2 border-t border-line px-3 py-3">\{children\}<\/div> : null/);
assert.doesNotMatch(notifications, /defaultExpanded=\{true\}/);
assert.doesNotMatch(announcements, /defaultExpanded=\{true\}/);

const notifCardStart = notifications.indexOf("<ExpandableCommunicationCard");
const notifCardEnd = notifications.lastIndexOf("</ExpandableCommunicationCard>");
assert.notEqual(notifCardStart, -1, "carte Notifications introuvable");
const notifCard = notifications.slice(notifCardStart, notifCardEnd);
const notifSplit = notifCard.indexOf(">");
const notifOpening = notifCard.slice(0, notifSplit);
const notifDetail = notifCard.slice(notifSplit);
assert.doesNotMatch(notifOpening, /Archiver/);
assert.doesNotMatch(notifOpening, /row\.body/);
assert.doesNotMatch(notifOpening, /Ouvrir|Lire/);
assert.match(notifDetail, /row\.body/);
assert.match(notifDetail, /Archiver/);
assert.match(notifDetail, /Ouvrir|Lire/);
assert.match(notifDetail, /attachments/);

const listStart = announcements.indexOf("visibleItems.map");
const detailStart = announcements.indexOf("announcement-detail");
const listBlock = announcements.slice(listStart, detailStart);
const detailBlock = announcements.slice(detailStart);
assert.doesNotMatch(listBlock, /row\.audienceLabel/);
assert.doesNotMatch(listBlock, /row\.excerpt/);
assert.doesNotMatch(listBlock, /row\.content \|\| row\.message/);
assert.match(listBlock, /Annonce Somafrik/);
assert.match(detailBlock, /audienceLabel/);
assert.match(detailBlock, /viewed\.content \|\| viewed\.message/);
assert.match(detailBlock, /Archiver/);

assert.match(messages, /messages-conversation-item/);
assert.match(messages, /messages-thread/);
assert.match(messages, /selectedId/);
assert.doesNotMatch(messages, /ExpandableCommunicationCard/);

console.log("OK UX Communication Web : cartes compactes + détail/dépliage");
