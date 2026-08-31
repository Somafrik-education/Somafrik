import { useContext } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomTabBarHeightCallbackContext,
  type BottomTabBarProps,
} from "@react-navigation/bottom-tabs";
import { CommonActions } from "@react-navigation/native";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import {
  SOMAFRIK_TAB_ICON_DP,
  SOMAFRIK_TAB_ICON_LABEL_GAP_DP,
  SOMAFRIK_TAB_LABEL_LINE_DP,
  SOMAFRIK_TAB_SPACE_BELOW_LABEL_DP,
} from "../lib/tabBarItemInnerLayout";
import { NAVIGATION_TEST_IDS } from "../lib/mobileNavigationSpec";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { TAB_BAR_CONTENT_HEIGHT, TAB_LABEL_FONT_SIZE, shortBottomTabLabel } from "../lib/mobileUxV1Layout";

const ACTIVE = "#2563EB";
const INACTIVE = "#64748B";

function isHiddenTab(tabBarItemStyle: unknown): boolean {
  if (!tabBarItemStyle || typeof tabBarItemStyle !== "object") return false;
  const display = (tabBarItemStyle as { display?: string }).display;
  return display === "none";
}

export default function SomafrikBottomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { tabBarStyle } = useFloatingTabBarLayout();
  const onHeightChange = useContext(BottomTabBarHeightCallbackContext);

  const visibleRoutes = state.routes.filter((route) => {
    const { options } = descriptors[route.key];
    return !isHiddenTab(options.tabBarItemStyle);
  });

  return (
    <View
      testID={NAVIGATION_TEST_IDS.tabBar}
      accessibilityRole="tablist"
      onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
      style={[tabBarStyle, styles.bar]}
    >
      {visibleRoutes.map((route) => {
        const index = state.routes.indexOf(route);
        const { options } = descriptors[route.key];
        const focused = state.index === index;
        const color = focused ? ACTIVE : INACTIVE;
        const label =
          typeof options.tabBarLabel === "string"
            ? shortBottomTabLabel(route.name, options.tabBarLabel)
            : shortBottomTabLabel(route.name);
        const icon = options.tabBarIcon?.({ focused, color, size: SOMAFRIK_TAB_ICON_DP });

        return (
          <Pressable
            key={route.key}
            testID={options.tabBarButtonTestID}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            onPress={() => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.dispatch({
                  ...CommonActions.navigate(route.name, route.params),
                  target: state.key,
                });
              }
            }}
            onLongPress={() => {
              navigation.emit({ type: "tabLongPress", target: route.key });
            }}
            style={styles.item}
          >
            <View style={styles.icon}>{icon}</View>
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              allowFontScaling
              style={[styles.label, { color }]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingTop: 0,
    paddingBottom: 0,
    overflow: "visible",
  },
  item: {
    flex: 1,
    minWidth: 0,
    minHeight: MIN_TOUCH_TARGET_DP,
    height: TAB_BAR_CONTENT_HEIGHT,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: SOMAFRIK_TAB_SPACE_BELOW_LABEL_DP,
  },
  icon: {
    width: SOMAFRIK_TAB_ICON_DP,
    height: SOMAFRIK_TAB_ICON_DP,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SOMAFRIK_TAB_ICON_LABEL_GAP_DP,
  },
  label: {
    fontSize: TAB_LABEL_FONT_SIZE,
    lineHeight: SOMAFRIK_TAB_LABEL_LINE_DP,
    fontWeight: "700",
    letterSpacing: 0.1,
    textAlign: "center",
    includeFontPadding: false,
    width: "100%",
  },
});
