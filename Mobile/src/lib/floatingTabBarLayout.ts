/**
 * Calcul structurel de la bottom bar — logique pure, sans React Native.
 *
 * Repère : Y = 0 au bas du parent (écran / navigator), croissant vers le haut.
 * Les items sont posés au-dessus de `tabBarBottom + paddingBottom`.
 *
 * Android : `insets.bottom` est déjà réservé par la fenêtre / la barre système.
 * L'appliquer encore (height, padding ou bottom) remonte les boutons sans
 * gagner de protection — c'est le P1 visible. Seule une marge de sécurité
 * de 8 dp est réinjectée.
 * iOS : l'indicateur d'accueil est dans la fenêtre, donc `insets.bottom`
 * reste l'unique autorité, une seule fois.
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
/** Marge Android minimale — protection, pas un second insets.bottom. */
export const ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP = 8;

export type TabBarPlatform = "ios" | "android" | string;

export type TabBarItemGeometry = {
  itemTop: number;
  itemBottom: number;
  itemCenterY: number;
};

export type FloatingTabBarMetrics = TabBarItemGeometry & {
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
  if (platform === "android") {
    return ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP;
  }
  return reported;
}

/** Inset réellement appliqué aux items avant le commit 2 (max(reported, 8) Android). */
export function legacyResolvedInset(insetsBottom: number, platform: TabBarPlatform): number {
  const reported = Number.isFinite(insetsBottom) ? Math.max(0, insetsBottom) : 0;
  return Math.max(reported, platform === "android" ? ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP : 0);
}

/**
 * Géométrie utile des items (Y depuis le bas du parent).
 * `height = 52+inset / bottom = 0` et `height = 52 / bottom = inset`
 * produisent le même itemCenterY — le commit 1 ne descendait pas les boutons.
 */
export function measureTabBarItems(input: {
  tabBarBottom: number;
  paddingBottom: number;
  itemHeight: number;
}): TabBarItemGeometry {
  const itemBottom = input.tabBarBottom + input.paddingBottom;
  const itemTop = itemBottom + input.itemHeight;
  const itemCenterY = itemBottom + input.itemHeight / 2;
  return { itemTop, itemBottom, itemCenterY };
}

export function legacyItemGeometry(insetsBottom: number, platform: TabBarPlatform): TabBarItemGeometry {
  const inset = legacyResolvedInset(insetsBottom, platform);
  return measureTabBarItems({
    tabBarBottom: inset,
    paddingBottom: 0,
    itemHeight: TAB_BAR_CONTENT_HEIGHT,
  });
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
  const items = measureTabBarItems({ tabBarBottom, paddingBottom, itemHeight });
  const tabBarOccupiedHeight = tabBarHeight + tabBarBottom;
  const scrollContentPaddingBottom = tabBarOccupiedHeight + CONTENT_ABOVE_TAB_GAP;

  if (tabBarHeight < MIN_TOUCH_TARGET_DP || itemHeight < MIN_TOUCH_TARGET_DP) {
    throw new Error("tab bar items must stay >= 44 dp");
  }
  if (items.itemBottom < 0) {
    throw new Error("tab bar items must stay above the parent bottom");
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
    ...items,
  };
}
