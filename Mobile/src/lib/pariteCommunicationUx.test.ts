/**
 * UX Communication — résumé compact par défaut, détails/actions après dépliage.
 * Grammaire calquée sur pariteL1FinanceUx.test.ts, sans coupler Finance.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

const expandable = read("components/ExpandableCommunicationCard.tsx");
const announcements = read("screens/AnnouncementsScreen.tsx");
const notifications = read("screens/InternalNotificationsScreen.tsx");
const messages = read("screens/MessagesScreen.tsx");
const api = read("services/api.ts");
const hydration = read("services/domainHydrationApi.ts");
const notificationsApi = read("services/internalNotificationsApi.ts");

assert.match(expandable, /defaultExpanded = false/);
assert.match(expandable, /accessibilityRole="button"/);
assert.match(expandable, /accessibilityState=\{\{\s*expanded\s*\}\}/);
assert.match(expandable, /expanded \? <View style=\{styles\.detail\}>\{children\}<\/View> : null/);
assert.match(expandable, /chevron-down|chevron-up/);
assert.match(expandable, /MIN_TOUCH_TARGET_DP/);
assert.match(expandable, /les détails/);
assert.doesNotMatch(announcements, /defaultExpanded=\{true\}/);
assert.doesNotMatch(notifications, /defaultExpanded=\{true\}/);

const announcementsCard = sliceCard(announcements, "ExpandableCommunicationCard");
const announcementsOpening = cardOpening(announcementsCard);
const announcementsDetail = cardDetail(announcementsCard);
assert.match(announcements, /originLabel|systemBroadcast|Annonce Somafrik/);
assert.match(announcementsOpening, /subtitle=\{origin\}/);
assert.match(announcementsOpening, /badge=\{announcement\.readAt/);
assert.doesNotMatch(announcementsOpening, /Archiver/);
assert.doesNotMatch(announcementsOpening, /audience/);
assert.doesNotMatch(announcementsOpening, /announcement\.message/);
assert.match(announcementsDetail, /Archiver/);
assert.match(announcementsDetail, /announcement\.audience/);
assert.match(announcementsDetail, /announcement\.message \|\| announcement\.excerpt/);
assert.match(announcementsDetail, /StatusBadge/);

const notificationsCard = sliceCard(notifications, "ExpandableCommunicationCard");
const notificationsOpening = cardOpening(notificationsCard);
const notificationsDetail = cardDetail(notificationsCard);
assert.match(notificationsOpening, /badge=\{row\.readAt/);
assert.doesNotMatch(notificationsOpening, /Marquer comme lu/);
assert.doesNotMatch(notificationsOpening, /Archiver/);
assert.doesNotMatch(notificationsOpening, /row\.body/);
assert.match(notificationsDetail, /row\.body \|\| row\.excerpt/);
assert.match(notificationsDetail, /Marquer comme lu/);
assert.match(notificationsDetail, /Archiver/);
assert.match(notificationsDetail, /attachments/);

assert.match(messages, /openConversation|setSelectedConversation/);
assert.doesNotMatch(messages, /ExpandableCommunicationCard/);
assert.doesNotMatch(messages, /Archiver/);
assert.match(messages, /accessibilityLabel=\{item\.title\}/);
assert.match(messages, /Modal visible=\{Boolean\(selectedConversation\)\}/);

assert.doesNotMatch(api, /EXPO_PUBLIC_COMMUNICATION_UX_SMOKE/);
assert.doesNotMatch(hydration, /EXPO_PUBLIC_COMMUNICATION_UX_SMOKE/);
assert.doesNotMatch(notificationsApi, /EXPO_PUBLIC_COMMUNICATION_UX_SMOKE/);

console.log("OK UX Communication Mobile : cartes compactes + détails après dépliage");

function sliceCard(source: string, tag: string) {
  const start = source.indexOf(`<${tag}`);
  const end = source.lastIndexOf(`</${tag}>`);
  assert.notEqual(start, -1, `${tag} introuvable`);
  assert.notEqual(end, -1, `fermeture ${tag} introuvable`);
  return source.slice(start, end);
}

function cardOpening(card: string) {
  const split = card.indexOf(">");
  assert.notEqual(split, -1, "ouverture de carte Communication introuvable");
  return card.slice(0, split);
}

function cardDetail(card: string) {
  const split = card.indexOf(">");
  return card.slice(split);
}
