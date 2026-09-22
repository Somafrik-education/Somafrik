/**
 * AUDIT-COM-P3-01 — COM-F-28
 * CommunicationHeaderIcons est monté dans le header live (trio Web Topbar),
 * compact pour 320 dp, InternalNotifications only (#577).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";
import {
  COMPACT_HEADER_ROW_DP,
  HEADER_ACTIONS_SLOT_DP,
  HEADER_COMPACT_ACTION_DP,
  HEADER_COMMUNICATION_ICON_COUNT,
  HEADER_MENU_SLOT_DP,
  HEADER_ROW_PADDING_H,
  HEADER_TITLE_MIN_DP,
} from "./mobileUxV1Layout";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const headerSrc = fs.readFileSync(path.join(ROOT, "src/components/MobileAppHeader.tsx"), "utf8");
const iconsSrc = fs.readFileSync(path.join(ROOT, "src/components/CommunicationHeaderIcons.tsx"), "utf8");
const homeSrc = fs.readFileSync(path.join(ROOT, "src/screens/HomeScreen.tsx"), "utf8");

assert.match(headerSrc, /<CommunicationHeaderIcons/);
assert.match(headerSrc, /variant="header"/);
assert.doesNotMatch(homeSrc, /CommunicationHeaderIcons/, "Home ne duplique pas le trio header");

assert.match(iconsSrc, /mobile-header-messages/);
assert.match(iconsSrc, /mobile-header-announcements/);
assert.match(iconsSrc, /mobile-header-notifications/);
assert.match(iconsSrc, /canAccessMessagesRoute\(session\)/);
assert.match(iconsSrc, /resolvedNotificationsInboxRoute === "InternalNotifications"/);
assert.doesNotMatch(iconsSrc, /canPlatformNotifications/);
assert.doesNotMatch(headerSrc, /canPlatformNotifications/);
assert.doesNotMatch(headerSrc, /PlatformNotifications/);

assert.equal(COMPACT_HEADER_ROW_DP, 76);
assert.equal(
  HEADER_ACTIONS_SLOT_DP,
  MIN_TOUCH_TARGET_DP + HEADER_COMPACT_ACTION_DP * HEADER_COMMUNICATION_ICON_COUNT,
);
const title320 = 320 - (HEADER_ROW_PADDING_H + HEADER_MENU_SLOT_DP + HEADER_ACTIONS_SLOT_DP);
assert.ok(title320 >= HEADER_TITLE_MIN_DP, `320 dp titleWidth=${title320} < ${HEADER_TITLE_MIN_DP}`);

console.log("OK Mobile communicationHeaderIcons.p3.test.ts");
