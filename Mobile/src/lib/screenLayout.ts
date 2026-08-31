import { Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";
import {
  TAB_BAR_INNER_PADDING_DP,
  TAB_BAR_SIDE_INSET_DP,
} from "./mobileUxV1Layout";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";
import {
  computeFloatingTabBarMetrics,
  CONTENT_ABOVE_TAB_GAP,
  FLOATING_TAB_BAR_GAP,
  FLOATING_TAB_BAR_HEIGHT,
  type TabBarPlatform,
} from "./floatingTabBarLayout";

export {
  ANDROID_TAB_BAR_MIN_BOTTOM_INSET_DP,
  computeFloatingTabBarMetrics,
  CONTENT_ABOVE_TAB_GAP,
  FLOATING_TAB_BAR_GAP,
  FLOATING_TAB_BAR_HEIGHT,
  legacyItemGeometry,
  measureTabBarItems,
  resolveTabBarBottomInset,
  TAB_BAR_OPTICAL_TOP_PADDING_DP,
} from "./floatingTabBarLayout";

export function computeFloatingTabBarLayout(insets: EdgeInsets, platform: TabBarPlatform = Platform.OS) {
  const metrics = computeFloatingTabBarMetrics(insets, platform);

  return {
    ...metrics,
    tabBarStyle: {
      position: "absolute" as const,
      left: TAB_BAR_SIDE_INSET_DP,
      right: TAB_BAR_SIDE_INSET_DP,
      bottom: metrics.tabBarBottom,
      height: metrics.tabBarHeight,
      backgroundColor: "#FFFFFF",
      borderTopLeftRadius: 14,
      borderTopRightRadius: 14,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: "#E2E8F0",
      paddingTop: metrics.paddingTop,
      paddingBottom: metrics.paddingBottom,
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
