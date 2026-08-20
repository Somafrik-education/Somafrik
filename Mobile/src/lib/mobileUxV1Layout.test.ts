import assert from "node:assert/strict";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";
import {
  COMPACT_WELCOME_MAX_DP,
  MAX_BOTTOM_TABS,
  MAX_ROLE_TABS,
  MAX_TAB_LABEL_CHARS,
  SCHOOL_ADMIN_BOTTOM_LABELS,
  UX_V1_SPEC_VERSION,
  UX_V1_VALIDATION_VIEWPORT,
  UX_V1_VIEWPORTS,
  homeAboveFoldFits,
  schoolAdminLabelsFitAllViewports,
  tabLabelFitsViewport,
} from "./mobileUxV1Layout";

assert.equal(UX_V1_SPEC_VERSION, "1.1");
assert.equal(MAX_BOTTOM_TABS, 5);
assert.equal(MAX_ROLE_TABS, 4);
assert.equal(COMPACT_WELCOME_MAX_DP, 110);
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
assert.equal(
  homeAboveFoldFits(UX_V1_VALIDATION_VIEWPORT, { top: 24, bottom: 16 }),
  true,
  "360×800 : welcome + Vue d’ensemble + 2 KPI au-dessus de la bottom nav",
);
assert.equal(
  homeAboveFoldFits({ width: 320, height: 640 }, { top: 24, bottom: 16 }),
  true,
  "petit écran : above-the-fold compact",
);

console.log("mobileUxV1Layout.test.ts OK");
