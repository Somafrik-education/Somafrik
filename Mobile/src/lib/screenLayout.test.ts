import assert from "node:assert/strict";
import {
  ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP,
  computeFloatingTabBarMetrics,
  FLOATING_TAB_BAR_HEIGHT,
  legacyDoubleCountedDeadZone,
} from "./floatingTabBarLayout";
import { TAB_BAR_CONTENT_HEIGHT } from "./mobileUxV1Layout";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";

type Case = {
  platform: "android" | "ios";
  insetsBottom: number;
  expectedInset: number;
};

const cases: Case[] = [
  { platform: "android", insetsBottom: 0, expectedInset: ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP },
  { platform: "android", insetsBottom: 24, expectedInset: 24 },
  { platform: "android", insetsBottom: 48, expectedInset: 48 },
  { platform: "ios", insetsBottom: 0, expectedInset: 0 },
  { platform: "ios", insetsBottom: 34, expectedInset: 34 },
];

for (const { platform, insetsBottom, expectedInset } of cases) {
  const metrics = computeFloatingTabBarMetrics({ bottom: insetsBottom }, platform);
  const label = `${platform} inset ${insetsBottom}`;

  assert.equal(metrics.bottomInset, expectedInset, `${label}: inset résolu`);
  assert.equal(metrics.tabBarHeight, TAB_BAR_CONTENT_HEIGHT, `${label}: hauteur = contenu seul`);
  assert.equal(metrics.tabBarHeight, FLOATING_TAB_BAR_HEIGHT, `${label}: alias hauteur`);
  assert.equal(metrics.itemHeight, TAB_BAR_CONTENT_HEIGHT, `${label}: items = zone utile`);
  assert.equal(metrics.tabBarBottom, expectedInset, `${label}: safe-area via bottom uniquement`);
  assert.equal(metrics.paddingBottom, 0, `${label}: paddingBottom n'est pas la safe-area`);
  if (metrics.bottomInset > 0) {
    assert.notEqual(
      metrics.tabBarHeight,
      TAB_BAR_CONTENT_HEIGHT + metrics.bottomInset,
      `${label}: interdiction height = content + inset`,
    );
    assert.notEqual(
      metrics.paddingBottom,
      metrics.bottomInset,
      `${label}: interdiction paddingBottom = inset`,
    );
  }
  assert.equal(metrics.deadZoneBelowItems, 0, `${label}: pas de zone morte sous les items`);
  assert.ok(metrics.tabBarHeight >= MIN_TOUCH_TARGET_DP, `${label}: zone tactile >= 44`);
  assert.ok(metrics.itemHeight >= MIN_TOUCH_TARGET_DP, `${label}: item >= 44`);
  assert.equal(
    metrics.tabBarOccupiedHeight,
    metrics.tabBarHeight + metrics.tabBarBottom,
    `${label}: occupation = barre + inset`,
  );

  const legacyDeadZone = legacyDoubleCountedDeadZone(expectedInset);
  assert.equal(legacyDeadZone, expectedInset * 2, `${label}: l'ancien calcul doublait l'inset`);
  assert.ok(
    expectedInset === 0 || metrics.deadZoneBelowItems < legacyDeadZone,
    `${label}: le correctif supprime la bande morte de l'ancien calcul`,
  );
}

console.log("screenLayout.test.ts OK");
