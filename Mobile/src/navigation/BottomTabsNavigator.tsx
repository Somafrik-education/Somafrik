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
      adjustsFontSizeToFit
      minimumFontScale={0.75}
      maxFontSizeMultiplier={1.3}
      allowFontScaling
      style={{
        color,
        fontSize: 11,
        fontWeight: "800",
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
        tabBarShowLabel: true,
        tabBarActiveTintColor: "#FFFFFF",
        tabBarInactiveTintColor: "#94A3B8",
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
          height: 52,
          borderRadius: 16,
          marginHorizontal: 0,
          paddingVertical: 2,
        },
        tabBarIcon: ({ focused }) => {
          if (route.name === "Accueil") {
            return (
              <Ionicons
                name={focused ? "home" : "home-outline"}
                size={22}
                color={focused ? "#FFFFFF" : "#94A3B8"}
              />
            );
          }

          const config = findTabDefinition(route.name, visibleTabs, overflowTabs, hiddenTabs);
          const iconName = focused ? config?.focusedIcon ?? "ellipse-outline" : config?.icon ?? "ellipse-outline";

          return (
            <Ionicons
              name={iconName}
              size={22}
              color={focused ? "#FFFFFF" : "#94A3B8"}
            />
          );
        },
      })}
    >
      <Tab.Screen
        name="Accueil"
        component={HomeScreen}
        options={{
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
            options={
              tabTestId
                ? {
                    tabBarButtonTestID: tabTestId,
                    tabBarAccessibilityLabel: tab.label,
                  }
                : { tabBarAccessibilityLabel: tab.label }
            }
          />
        );
      })}
      {hiddenTabs.map((tab) => (
        <Tab.Screen
          key={`hidden-${tab.tabName}`}
          name={tab.tabName}
          component={tab.component}
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
  return definition?.label ?? tabName;
}
