/**
 * Calcul structurel de la bottom bar — logique pure, sans React Native.
 * L'inset système n'a qu'une autorité : `tabBarBottom`.
 */

import {
  TAB_BAR_CONTENT_HEIGHT,
  TAB_BAR_GAP_DP,
} from "./mobileUxV1Layout";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";

export const FLOATING_TAB_BAR_HEIGHT = TAB_BAR_CONTENT_HEIGHT;
export const FLOATING_TAB_BAR_GAP = TAB_BAR_GAP_DP;
export const CONTENT_ABOVE_TAB_GAP = 8;
/** Padding optique interne — ce n'est pas la safe-area système. */
export const TAB_BAR_OPTICAL_TOP_PADDING_DP = 2;
/** Marge Android minimale quand le système ne reporte aucun inset. */
export const ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP = 8;

export type TabBarPlatform = "ios" | "android" | string;

export type FloatingTabBarMetrics = {
  bottomInset: number;
  tabBarHeight: number;
  tabBarBottom: number;
  paddingTop: number;
  paddingBottom: number;
  itemHeight: number;
  deadZoneBelowItems: number;
  tabBarOccupiedHeight: number;
  scrollContentPaddingBottom: number;
};

export function resolveTabBarBottomInset(insetsBottom: number, platform: TabBarPlatform): number {
  const reported = Number.isFinite(insetsBottom) ? Math.max(0, insetsBottom) : 0;
  return Math.max(reported, platform === "android" ? ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP : 0);
}

/**
 * Avant ce correctif, screenLayout faisait :
 *   height = CONTENT + inset
 *   paddingBottom = inset
 *   bottom = 0
 * ce qui comptabilisait l'inset deux fois et créait une bande morte
 * sous les items (legacyDeadZone = 2 × inset).
 */
export function legacyDoubleCountedDeadZone(bottomInset: number): number {
  const legacyHeight = TAB_BAR_CONTENT_HEIGHT + bottomInset;
  const legacyPaddingBottom = bottomInset;
  return legacyHeight - TAB_BAR_CONTENT_HEIGHT + legacyPaddingBottom;
}

export function computeFloatingTabBarMetrics(
  insets: { bottom: number },
  platform: TabBarPlatform,
): FloatingTabBarMetrics {
  const bottomInset = resolveTabBarBottomInset(insets.bottom, platform);
  const tabBarHeight = FLOATING_TAB_BAR_HEIGHT;
  const tabBarBottom = FLOATING_TAB_BAR_GAP + bottomInset;
  const paddingTop = TAB_BAR_OPTICAL_TOP_PADDING_DP;
  const paddingBottom = 0;
  const itemHeight = TAB_BAR_CONTENT_HEIGHT;
  const deadZoneBelowItems = Math.max(0, tabBarHeight - itemHeight);
  const tabBarOccupiedHeight = tabBarHeight + tabBarBottom;
  const scrollContentPaddingBottom = tabBarOccupiedHeight + CONTENT_ABOVE_TAB_GAP;

  if (tabBarHeight < MIN_TOUCH_TARGET_DP) {
    throw new Error("tabBarHeight must stay >= 44 dp");
  }

  return {
    bottomInset,
    tabBarHeight,
    tabBarBottom,
    paddingTop,
    paddingBottom,
    itemHeight,
    deadZoneBelowItems,
    tabBarOccupiedHeight,
    scrollContentPaddingBottom,
  };
}
