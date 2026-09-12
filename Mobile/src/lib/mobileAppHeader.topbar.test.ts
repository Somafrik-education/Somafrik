/**
 * Contrat UI TopBar mobile — header Accueil uniquement.
 * RED → GREEN : pas de loupe, menu 32/48, rangée ~76 dp, 360/390 sans débordement.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";
import {
  COMPACT_HEADER_ROW_DP,
  HEADER_ACTIONS_SLOT_DP,
  HEADER_MENU_SLOT_DP,
  UX_V1_VIEWPORTS,
} from "./mobileUxV1Layout";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const headerSrc = fs.readFileSync(path.join(srcRoot, "components", "MobileAppHeader.tsx"), "utf8");

const TOPBAR_MIN_DP = 72;
const TOPBAR_MAX_DP = 80;
const MENU_ICON_DP = 32;
const MENU_TOUCH_DP = 48;
const TITLE_MIN_DP = 96;
const HEADER_ROW_PADDING_H = 4;
const VALIDATION_WIDTHS = [360, 390] as const;

assert.match(headerSrc, /testID="mobile-app-header"/);
assert.match(headerSrc, /testID="mobile-header-menu"/);
assert.match(headerSrc, /testID="mobile-header-school-name"/);
assert.match(headerSrc, /testID="mobile-header-sync"/);
assert.match(headerSrc, /testID="mobile-header-notifications"/);
assert.match(headerSrc, /accessibilityLabel="Ouvrir le menu"/);
assert.match(headerSrc, /accessibilityLabel=\{`\$\{label\}\$\{badgeLabel\}`\}/);

assert.doesNotMatch(headerSrc, /mobile-header-search/, "aucune icône Recherche dans la TopBar");
assert.doesNotMatch(headerSrc, /search-outline/, "aucune loupe Ionicons dans la TopBar");
assert.doesNotMatch(headerSrc, /searchRoute/, "aucune route de recherche dans la TopBar");
assert.doesNotMatch(headerSrc, /label="Rechercher"/, "aucun bouton Rechercher dans la TopBar");
assert.doesNotMatch(
  headerSrc,
  /canReadRoute\(session, "TeacherStudents"\)/,
  "la TopBar ne doit plus résoudre une destination de recherche élèves",
);

const menuIdx = headerSrc.indexOf('testID="mobile-header-menu"');
const schoolIdx = headerSrc.indexOf('testID="mobile-header-school-name"');
const syncIdx = headerSrc.indexOf('testID="mobile-header-sync"');
const searchIdx = headerSrc.indexOf('testID="mobile-header-search"');
const notifIdx = headerSrc.indexOf('testID="mobile-header-notifications"');
assert.ok(menuIdx >= 0 && schoolIdx > menuIdx, "MENU avant le nom d'établissement");
assert.ok(syncIdx > schoolIdx, "ACTUALISER après le nom d'établissement");
assert.ok(notifIdx > syncIdx, "NOTIFICATIONS après Actualiser");
assert.equal(searchIdx, -1, "aucun testID Recherche entre Actualiser et Notifications");

assert.match(headerSrc, /onPress=\{\(\) => setDrawerOpen\(true\)\}/);
assert.match(headerSrc, /<RoleNavigationDrawer/);
assert.match(headerSrc, /visible=\{drawerOpen\}/);
assert.match(headerSrc, /onClose=\{\(\) => setDrawerOpen\(false\)\}/);
assert.match(headerSrc, /SafeAreaView edges=\{\["top"\]\}/);
assert.match(headerSrc, /numberOfLines=\{1\}/);
assert.match(headerSrc, /flex:\s*1/);
assert.match(headerSrc, /minHeight: COMPACT_HEADER_ROW_DP/);
assert.match(headerSrc, /HEADER_ACTIONS_SLOT_DP/);
assert.match(headerSrc, /HEADER_MENU_SLOT_DP/);
assert.match(headerSrc, /count=\{canInternalNotifications \? internalUnread : 0\}/);

assert.match(
  headerSrc,
  /name="menu"\s+size=\{(?:32|HEADER_MENU_ICON_DP)\}/,
  "hamburger 32 dp",
);
assert.match(
  headerSrc,
  /(?:HEADER_MENU_TOUCH_DP|minWidth:\s*48)/,
  "cible tactile menu 48 dp",
);

assert.ok(
  COMPACT_HEADER_ROW_DP >= TOPBAR_MIN_DP && COMPACT_HEADER_ROW_DP <= TOPBAR_MAX_DP,
  `TopBar minHeight ${COMPACT_HEADER_ROW_DP} hors cible 72–80 dp`,
);
assert.equal(COMPACT_HEADER_ROW_DP, 76, "cible CTO : rangée TopBar 76 dp");
assert.equal(HEADER_MENU_SLOT_DP, MENU_TOUCH_DP, "slot menu = cible tactile 48 dp");
assert.equal(
  HEADER_ACTIONS_SLOT_DP,
  MIN_TOUCH_TARGET_DP * 2,
  "slot actions = Actualiser + Notifications, sans place réservée à la loupe",
);

function measureTopBarRow(viewportWidth: number) {
  const occupied = HEADER_ROW_PADDING_H + HEADER_MENU_SLOT_DP + HEADER_ACTIONS_SLOT_DP;
  const titleWidth = viewportWidth - occupied;
  return {
    viewportWidth,
    occupied,
    titleWidth,
    overflows: occupied > viewportWidth || titleWidth < TITLE_MIN_DP,
    menuIcon: MENU_ICON_DP,
    menuTouch: MENU_TOUCH_DP,
    rowMinHeight: COMPACT_HEADER_ROW_DP,
  };
}

for (const width of VALIDATION_WIDTHS) {
  const row = measureTopBarRow(width);
  assert.equal(row.overflows, false, `${width} px : TopBar déborde (titleWidth=${row.titleWidth})`);
  assert.ok(row.titleWidth >= TITLE_MIN_DP, `${width} px : nom d'établissement trop serré`);
  assert.ok(row.menuTouch >= 48);
  assert.ok(row.rowMinHeight >= 72);
}

for (const width of UX_V1_VIEWPORTS) {
  const row = measureTopBarRow(width);
  assert.equal(row.overflows, false, `${width} dp : overflow TopBar`);
}

console.log("mobileAppHeader.topbar.test.ts OK");
