import { Platform } from "react-native";
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";
import {
  FLOATING_TAB_BAR_HEIGHT_V11,
  TAB_BAR_INNER_PADDING_DP,
  TAB_BAR_SIDE_INSET_DP,
} from "./mobileUxV1Layout";
import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";

export const FLOATING_TAB_BAR_HEIGHT = FLOATING_TAB_BAR_HEIGHT_V11;
export const FLOATING_TAB_BAR_GAP = 6;
export const CONTENT_ABOVE_TAB_GAP = 12;

function getTabBarBottomOffset(insets: EdgeInsets): number {
  const minBottom = Platform.OS === "android" ? 10 : 8;
  return Math.max(insets.bottom, minBottom) + FLOATING_TAB_BAR_GAP;
}

export function computeFloatingTabBarLayout(insets: EdgeInsets) {
  const tabBarBottom = getTabBarBottomOffset(insets);
  const tabBarOccupiedHeight = FLOATING_TAB_BAR_HEIGHT + tabBarBottom;
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
      height: FLOATING_TAB_BAR_HEIGHT,
      backgroundColor: "#0F172A",
      borderRadius: 20,
      borderTopWidth: 0,
      paddingTop: 4,
      paddingBottom: 6,
      paddingHorizontal: TAB_BAR_INNER_PADDING_DP,
      elevation: 12,
      shadowColor: "#000",
      shadowOffset: {
        width: 0,
        height: 5,
      },
      shadowOpacity: 0.15,
      shadowRadius: 10,
      overflow: "visible" as const,
      minHeight: MIN_TOUCH_TARGET_DP + 8,
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
