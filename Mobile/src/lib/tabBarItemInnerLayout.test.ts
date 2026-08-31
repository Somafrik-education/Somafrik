import assert from "node:assert/strict";
import {
  ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP,
  computeFloatingTabBarMetrics,
} from "./floatingTabBarLayout";
import { TAB_BAR_CONTENT_HEIGHT } from "./mobileUxV1Layout";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";
import {
  computeTabItemInnerLayout,
  TAB_ITEM_INNER_ALIGN,
  TAB_ITEM_RN_PADDING_DP,
  tabItemTouchTargetOk,
} from "./tabBarItemInnerLayout";

const start = computeTabItemInnerLayout(TAB_BAR_CONTENT_HEIGHT, "flex-start");
const end = computeTabItemInnerLayout(TAB_BAR_CONTENT_HEIGHT, "flex-end");

assert.equal(TAB_ITEM_INNER_ALIGN, "flex-end");
assert.equal(start.itemHeight, 52);
assert.equal(end.itemHeight, 52);
assert.ok(start.spaceBelowLabel > TAB_ITEM_RN_PADDING_DP, "flex-start : slack sous le label");
assert.equal(end.spaceBelowLabel, TAB_ITEM_RN_PADDING_DP, "flex-end : seule la respiration RN (5 dp)");
assert.ok(end.clusterTop > start.clusterTop, "le bloc icône+label descend dans les 52 dp");
assert.ok(end.labelBottom > start.labelBottom, "le libellé se rapproche du bas du conteneur");
assert.ok(end.spaceBelowLabel < start.spaceBelowLabel);

assert.equal(tabItemTouchTargetOk(52), true);
assert.ok(TAB_BAR_CONTENT_HEIGHT >= MIN_TOUCH_TARGET_DP);

const android = computeFloatingTabBarMetrics({ bottom: 48 }, "android");
assert.equal(android.tabBarHeight, 52, "#414 : hauteur 52 inchangée");
assert.equal(android.bottomInset, ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP, "#414 : Android bottom = 8");
assert.equal(android.tabBarBottom, 8);
assert.notEqual(android.tabBarHeight, 52 + 48, "pas de retour du double inset");
assert.notEqual(android.paddingBottom, 48);

console.log("tabBarItemInnerLayout.test.ts OK");
