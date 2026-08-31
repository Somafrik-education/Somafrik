import assert from "node:assert/strict";
import {
  ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP,
  computeFloatingTabBarMetrics,
  FLOATING_TAB_BAR_HEIGHT,
  legacyItemGeometry,
  legacyResolvedInset,
  measureTabBarItems,
} from "./floatingTabBarLayout";
import { TAB_BAR_CONTENT_HEIGHT } from "./mobileUxV1Layout";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";

type Case = {
  platform: "android" | "ios";
  insetsBottom: number;
};

const cases: Case[] = [
  { platform: "android", insetsBottom: 0 },
  { platform: "android", insetsBottom: 24 },
  { platform: "android", insetsBottom: 48 },
  { platform: "ios", insetsBottom: 0 },
  { platform: "ios", insetsBottom: 34 },
];

assert.deepEqual(
  measureTabBarItems({ tabBarBottom: 0, paddingBottom: 48, itemHeight: 52 }),
  measureTabBarItems({ tabBarBottom: 48, paddingBottom: 0, itemHeight: 52 }),
  "height+=inset/bottom=0 et height=52/bottom=inset : même itemCenterY",
);

for (const { platform, insetsBottom } of cases) {
  const metrics = computeFloatingTabBarMetrics({ bottom: insetsBottom }, platform);
  const legacy = legacyItemGeometry(insetsBottom, platform);
  const label = `${platform} inset ${insetsBottom}`;

  assert.equal(metrics.tabBarHeight, TAB_BAR_CONTENT_HEIGHT, `${label}: hauteur = contenu seul`);
  assert.equal(metrics.tabBarHeight, FLOATING_TAB_BAR_HEIGHT, `${label}: alias hauteur`);
  assert.equal(metrics.itemHeight, TAB_BAR_CONTENT_HEIGHT, `${label}: items = zone utile`);
  assert.equal(metrics.paddingBottom, 0, `${label}: paddingBottom n'est pas la safe-area`);
  assert.equal(metrics.deadZoneBelowItems, 0, `${label}: pas de bande morte interne`);
  assert.equal(metrics.itemBottom, metrics.tabBarBottom + metrics.paddingBottom, `${label}: itemBottom`);
  assert.equal(metrics.itemTop, metrics.itemBottom + metrics.itemHeight, `${label}: itemTop`);
  assert.equal(metrics.itemCenterY, metrics.itemBottom + metrics.itemHeight / 2, `${label}: itemCenterY`);
  assert.ok(metrics.itemBottom >= 0, `${label}: items au-dessus du bas parent`);
  assert.ok(metrics.tabBarHeight >= MIN_TOUCH_TARGET_DP, `${label}: barre >= 44`);
  assert.ok(metrics.itemHeight >= MIN_TOUCH_TARGET_DP, `${label}: item >= 44`);

  if (platform === "android") {
    assert.equal(metrics.bottomInset, ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP, `${label}: Android ignore insets.bottom`);
    assert.equal(metrics.itemBottom, ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP, `${label}: itemBottom = marge 8`);
    assert.equal(metrics.itemCenterY, ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP + TAB_BAR_CONTENT_HEIGHT / 2);
    const legacyInset = legacyResolvedInset(insetsBottom, "android");
    if (insetsBottom > ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP) {
      assert.ok(
        metrics.itemCenterY < legacy.itemCenterY,
        `${label}: itemCenterY doit descendre (${metrics.itemCenterY} < ${legacy.itemCenterY})`,
      );
      assert.equal(legacy.itemCenterY - metrics.itemCenterY, legacyInset - ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP);
    } else {
      assert.equal(metrics.itemCenterY, legacy.itemCenterY, `${label}: inset 0, même centre`);
    }
  } else {
    assert.equal(metrics.bottomInset, insetsBottom, `${label}: iOS conserve l'indicateur d'accueil`);
    assert.equal(metrics.itemBottom, insetsBottom, `${label}: iOS itemBottom = inset`);
    assert.equal(metrics.itemCenterY, legacy.itemCenterY, `${label}: iOS ne descend pas sous l'home indicator`);
  }
}

console.log("screenLayout.test.ts OK");
