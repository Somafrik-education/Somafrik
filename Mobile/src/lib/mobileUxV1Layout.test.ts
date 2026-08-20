import assert from "node:assert/strict";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";
import {
  COMPACT_HEADER_ROW_DP,
  IDENTITY_CARD_MIN_DP,
  MISSION_BANNER_MIN_DP,
  HEADER_ACTIONS_SLOT_DP,
  HEADER_BADGE_BAND_DP,
  HEADER_MENU_SLOT_DP,
  HOME_SCROLL_TOP_DP,
  KPI_ROW_MIN_DP,
  MAX_BOTTOM_TABS,
  MAX_ROLE_TABS,
  MAX_TAB_LABEL_CHARS,
  SCHOOL_ADMIN_BOTTOM_LABELS,
  TAB_BAR_CONTENT_HEIGHT,
  TAB_BAR_SIDE_INSET_DP,
  TAB_LABEL_FONT_SIZE,
  UX_V1_FONT_SCALES,
  UX_V1_SPEC_VERSION,
  UX_V1_VALIDATION_VIEWPORT,
  UX_V1_VIEWPORTS,
  homeAboveFoldFits,
  homeAboveFoldFitsAllViewports,
  measureHomeShell,
  schoolAdminLabelsFitAllViewports,
  shortBottomTabLabel,
  tabLabelFitsViewport,
} from "./mobileUxV1Layout";

assert.equal(UX_V1_SPEC_VERSION, "2.0");
assert.equal(MAX_BOTTOM_TABS, 5);
assert.equal(MAX_ROLE_TABS, 4);
assert.equal(COMPACT_HEADER_ROW_DP, 44);
assert.equal(HEADER_ACTIONS_SLOT_DP, MIN_TOUCH_TARGET_DP * 3);
assert.equal(HEADER_MENU_SLOT_DP, MIN_TOUCH_TARGET_DP);
assert.equal(HEADER_BADGE_BAND_DP, 18);
assert.equal(shortBottomTabLabel("Utilisateurs"), "Comptes");
assert.equal(shortBottomTabLabel("Enseignants"), "Profs");
assert.equal(shortBottomTabLabel("Paiements"), "Frais");
assert.equal(IDENTITY_CARD_MIN_DP, 88);
assert.equal(MISSION_BANNER_MIN_DP, 72);
assert.equal(HOME_SCROLL_TOP_DP, 4);
assert.equal(KPI_ROW_MIN_DP, 92);
assert.equal(TAB_BAR_CONTENT_HEIGHT, 52);
assert.equal(TAB_BAR_SIDE_INSET_DP, 0);
assert.equal(TAB_LABEL_FONT_SIZE, 10);
assert.ok(MIN_TOUCH_TARGET_DP >= 44);

assert.deepEqual([...SCHOOL_ADMIN_BOTTOM_LABELS], ["Accueil", "Classes", "Frais", "Comptes", "Profs"]);
assert.ok(SCHOOL_ADMIN_BOTTOM_LABELS.every((label) => label.length <= MAX_TAB_LABEL_CHARS));
assert.equal(
  SCHOOL_ADMIN_BOTTOM_LABELS.some((label) => /Utilisateurs|Enseignants/.test(label)),
  false,
);

assert.equal(schoolAdminLabelsFitAllViewports(1), true, "labels school_admin tiennent en 320–412 dp");
assert.equal(schoolAdminLabelsFitAllViewports(1.3), true, "labels school_admin tiennent à fontScale 1.3");

for (const width of UX_V1_VIEWPORTS) {
  assert.equal(tabLabelFitsViewport("Utilisateurs", width), false, `${width}dp : Utilisateurs doit être refusé`);
  assert.equal(tabLabelFitsViewport("Enseignants", width), false, `${width}dp : Enseignants doit être refusé`);
}

assert.equal(UX_V1_VALIDATION_VIEWPORT.width, 360);
assert.equal(UX_V1_VALIDATION_VIEWPORT.height, 800);

const validation = measureHomeShell(UX_V1_VALIDATION_VIEWPORT, { top: 24, bottom: 16 }, 1);
assert.equal(validation.kpiCompleteAboveTab, true, "360×800 : ≥ 2 KPI complets au-dessus de la bottom nav");
assert.ok(validation.welcomeBottom - validation.headerBottom >= IDENTITY_CARD_MIN_DP);
assert.ok(validation.kpiRowBottom <= validation.tabTop - 8);

assert.equal(
  homeAboveFoldFits(UX_V1_VALIDATION_VIEWPORT, { top: 24, bottom: 16 }),
  true,
  "360×800 : identité + bannière + Vue métier + 2 KPI au-dessus de la bottom nav",
);
assert.equal(
  homeAboveFoldFits({ width: 320, height: 640 }, { top: 24, bottom: 16 }),
  true,
  "petit écran : above-the-fold compact",
);

assert.equal(homeAboveFoldFitsAllViewports(), true, "320/360/390/412 × fontScale 1.0/1.3");

for (const width of UX_V1_VIEWPORTS) {
  for (const fontScale of UX_V1_FONT_SCALES) {
    const height = Math.max(640, Math.round((width * 800) / 360));
    const shell = measureHomeShell({ width, height }, { top: 24, bottom: 16 }, fontScale);
    assert.equal(
      shell.kpiCompleteAboveTab,
      true,
      `${width}×${height} fontScale ${fontScale}: kpiRowBottom=${shell.kpiRowBottom} tabTop=${shell.tabTop}`,
    );
  }
}

console.log("mobileUxV1Layout.test.ts OK");
