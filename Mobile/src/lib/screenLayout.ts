import { Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";
import {
  TAB_BAR_CONTENT_HEIGHT,
  TAB_BAR_GAP_DP,
  TAB_BAR_INNER_PADDING_DP,
  TAB_BAR_SIDE_INSET_DP,
} from "./mobileUxV1Layout";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";

/** Hauteur de contenu (hors safe area). Alias historique conservé. */
export const FLOATING_TAB_BAR_HEIGHT = TAB_BAR_CONTENT_HEIGHT;
export const FLOATING_TAB_BAR_GAP = TAB_BAR_GAP_DP;
export const CONTENT_ABOVE_TAB_GAP = 8;

export function computeFloatingTabBarLayout(insets: EdgeInsets) {
  const bottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 8 : 0);
  const tabBarBottom = FLOATING_TAB_BAR_GAP;
  const tabBarHeight = FLOATING_TAB_BAR_HEIGHT + bottomInset;
  const tabBarOccupiedHeight = tabBarHeight + tabBarBottom;
  const scrollContentPaddingBottom = tabBarOccupiedHeight + CONTENT_ABOVE_TAB_GAP;

  return {
    tabBarBottom,
    tabBarOccupiedHeight,
    scrollContentPaddingBottom,
    tabBarStyle: {
      position: "absolute" as const,
      left: TAB_BAR_SIDE_INSET_DP,
      right: TAB_BAR_SIDE_INSET_DP,
      bottom: tabBarBottom,
      height: tabBarHeight,
      backgroundColor: "#FFFFFF",
      borderTopLeftRadius: 14,
      borderTopRightRadius: 14,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: "#E2E8F0",
      paddingTop: 2,
      paddingBottom: bottomInset,
      paddingHorizontal: TAB_BAR_INNER_PADDING_DP,
      elevation: 10,
      shadowColor: "#0F172A",
      shadowOffset: {
        width: 0,
        height: -3,
      },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      overflow: "visible" as const,
      minHeight: MIN_TOUCH_TARGET_DP,
    },
  };
}

export function useFloatingTabBarLayout() {
  const insets = useSafeAreaInsets();
  return computeFloatingTabBarLayout(insets);
}

/** Bottom padding for stack screens (no floating tab bar). */
export function useStackScreenBottomPadding(): number {
  const insets = useSafeAreaInsets();
  return Math.max(insets.bottom, 16) + 24;
}
