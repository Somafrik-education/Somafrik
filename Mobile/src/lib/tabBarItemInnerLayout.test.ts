import assert from "node:assert/strict";
import {
  ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP,
  computeFloatingTabBarMetrics,
} from "./floatingTabBarLayout";
import { TAB_BAR_CONTENT_HEIGHT } from "./mobileUxV1Layout";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";
import {
  computeSomafrikTabItemGeometry,
  projectItemToParentUp,
  SOMAFRIK_TAB_ICON_DP,
  SOMAFRIK_TAB_SPACE_BELOW_LABEL_DP,
  spaceBelowLabelIsWithinAndroidBudget,
  tabItemTouchTargetOk,
} from "./tabBarItemInnerLayout";

const geo = computeSomafrikTabItemGeometry();

assert.equal(geo.itemHeight, 52);
assert.equal(geo.itemTop, 0);
assert.equal(geo.itemBottom, 52);
assert.equal(geo.iconTop, 15);
assert.equal(geo.iconBottom, 35);
assert.equal(geo.labelTop, 37);
assert.equal(geo.labelBottom, 49);
assert.equal(geo.spaceBelowLabel, 3);
assert.equal(geo.spaceBelowLabel, SOMAFRIK_TAB_SPACE_BELOW_LABEL_DP);
assert.ok(spaceBelowLabelIsWithinAndroidBudget(geo.spaceBelowLabel), "2–5 dp sous le libellé");
assert.equal(geo.labelBottom, 52 - geo.spaceBelowLabel);
assert.ok(geo.labelTop < geo.labelBottom);
assert.ok(geo.iconTop < geo.iconBottom);
assert.ok(geo.iconBottom <= geo.labelTop);
assert.equal(geo.iconBottom - geo.iconTop, SOMAFRIK_TAB_ICON_DP);
assert.ok(geo.iconTop >= 0, "icône dans les 52 dp");
assert.equal(tabItemTouchTargetOk(52), true);
assert.ok(TAB_BAR_CONTENT_HEIGHT >= MIN_TOUCH_TARGET_DP);

const android = computeFloatingTabBarMetrics({ bottom: 48 }, "android");
assert.equal(android.tabBarHeight, 52, "#414 : hauteur 52 inchangée");
assert.equal(android.bottomInset, ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP, "#414 : Android bottom = 8");
assert.equal(android.tabBarBottom, 8);
assert.notEqual(android.tabBarHeight, 52 + 48, "pas de retour du double inset");
assert.notEqual(android.paddingBottom, 48);

const ios = computeFloatingTabBarMetrics({ bottom: 34 }, "ios");
assert.equal(ios.tabBarHeight, 52);
assert.equal(ios.tabBarBottom, 34, "#414 : iOS conserve l'indicateur d'accueil");

const androidOnScreen = projectItemToParentUp(geo, android.itemBottom);
assert.equal(androidOnScreen.itemBottom, 8);
assert.equal(androidOnScreen.itemTop, 60);
assert.equal(androidOnScreen.iconTop, 45);
assert.equal(androidOnScreen.iconBottom, 25);
assert.equal(androidOnScreen.labelTop, 23);
assert.equal(androidOnScreen.labelBottom, 11);
assert.equal(androidOnScreen.spaceBelowLabel, 3);

console.log("tabBarItemInnerLayout.test.ts OK");
