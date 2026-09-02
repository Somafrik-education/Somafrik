import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "react-native";

import HomeScreen from "../screens/HomeScreen";
import StudentsScreen from "../screens/StudentsScreen";
import { useAuth } from "../context/AuthContext";
import { canReadRoute } from "../domain/security/permissions";
import {
  partitionRoleTabs,
  type RoleTabDefinition,
} from "./roleTabPreferences";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { TAB_TEST_IDS } from "../lib/loginScreenSpec";
import { tabTestIdForTabName } from "../lib/mobileNavigationSpec";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { TAB_BAR_CONTENT_HEIGHT, TAB_LABEL_FONT_SIZE, shortBottomTabLabel } from "../lib/mobileUxV1Layout";
import MobileAppHeader from "../components/MobileAppHeader";

const Tab = createBottomTabNavigator();

const hiddenTabOptions = {
  tabBarButton: () => null,
  tabBarItemStyle: { display: "none" } as const,
};

function CompactTabLabel({ label, color }: { label: string; color: string }) {
  return (
    <Text
      numberOfLines={1}
      maxFontSizeMultiplier={1.3}
      allowFontScaling
      style={{
        color,
        fontSize: TAB_LABEL_FONT_SIZE,
        fontWeight: "700",
        letterSpacing: 0.1,
        textAlign: "center",
        width: "100%",
        includeFontPadding: false,
      }}
    >
      {label}
    </Text>
  );
}

export default function BottomTabsNavigator() {
  const { session } = useAuth();
  const { tabBarStyle } = useFloatingTabBarLayout();
  const { visibleTabs, overflowTabs } = partitionRoleTabs(session);
  const hiddenTabs = [...overflowTabs];
  const needsStudentsScreen =
    canReadRoute(session, "Students") &&
    !visibleTabs.some((tab) => tab.route === "Students") &&
    !hiddenTabs.some((tab) => tab.route === "Students");

  if (needsStudentsScreen) {
    hiddenTabs.push({
      tabName: "Students",
      route: "Students",
      component: StudentsScreen,
      label: "Élèves",
      icon: "people-outline",
      focusedIcon: "people",
      quickActionIcon: "people-outline",
      quickActionLabel: "Élèves",
    });
  }

  return (
    <Tab.Navigator
      screenOptions={({ route, navigation }) => ({
        headerShown: true,
        headerStatusBarHeight: 0,
        header: () => <MobileAppHeader navigation={navigation} />,
        safeAreaInsets: { top: 0, bottom: 0 },
        tabBarShowLabel: true,
        tabBarActiveTintColor: "#2563EB",
        tabBarInactiveTintColor: "#64748B",
        tabBarLabel: ({ color }) => (
          <CompactTabLabel
            label={getTabLabel(route.name, visibleTabs, overflowTabs, hiddenTabs)}
            color={color}
          />
        ),
        tabBarStyle,
        tabBarItemStyle: {
          flex: 1,
          minWidth: 0,
          minHeight: MIN_TOUCH_TARGET_DP,
          height: TAB_BAR_CONTENT_HEIGHT,
          marginHorizontal: 0,
          paddingVertical: 0,
        },
        tabBarIcon: ({ focused, color }) => {
          if (route.name === "Accueil") {
            return (
              <Ionicons
                name={focused ? "home" : "home-outline"}
                size={20}
                color={color}
              />
            );
          }

          const config = findTabDefinition(route.name, visibleTabs, overflowTabs, hiddenTabs);
          const iconName = focused ? config?.focusedIcon ?? "ellipse-outline" : config?.icon ?? "ellipse-outline";

          return (
            <Ionicons
              name={iconName}
              size={20}
              color={color}
            />
          );
        },
      })}
    >
      <Tab.Screen
        name="Accueil"
        component={HomeScreen}
        options={{
          tabBarLabel: "Accueil",
          tabBarButtonTestID: TAB_TEST_IDS.accueil,
          tabBarAccessibilityLabel: "Accueil",
        }}
      />
      {visibleTabs.map((tab) => {
        const tabTestId = tabTestIdForTabName(tab.tabName) ?? tabTestIdForTabName(tab.label);
        return (
          <Tab.Screen
            key={tab.tabName}
            name={tab.tabName}
            component={tab.component}
            initialParams={tab.initialParams}
            options={
              tabTestId
                ? {
                    tabBarLabel: tab.label,
                    tabBarButtonTestID: tabTestId,
                    tabBarAccessibilityLabel: tab.label,
                  }
                : { tabBarLabel: tab.label, tabBarAccessibilityLabel: tab.label }
            }
          />
        );
      })}
      {hiddenTabs.map((tab) => (
        <Tab.Screen
          key={`hidden-${tab.tabName}`}
          name={tab.tabName}
          component={tab.component}
          initialParams={tab.initialParams}
          options={hiddenTabOptions}
        />
      ))}
    </Tab.Navigator>
  );
}

function findTabDefinition(
  tabName: string,
  visibleTabs: RoleTabDefinition[],
  overflowTabs: RoleTabDefinition[],
  hiddenTabs: RoleTabDefinition[],
): RoleTabDefinition | undefined {
  return [...visibleTabs, ...overflowTabs, ...hiddenTabs].find((tab) => tab.tabName === tabName);
}

function getTabLabel(
  tabName: string,
  visibleTabs: RoleTabDefinition[],
  overflowTabs: RoleTabDefinition[],
  hiddenTabs: RoleTabDefinition[],
) {
  if (tabName === "Accueil") return "Accueil";
  const definition = findTabDefinition(tabName, visibleTabs, overflowTabs, hiddenTabs);
  return shortBottomTabLabel(tabName, definition?.label);
}
