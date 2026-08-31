import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

import HomeScreen from "../screens/HomeScreen";
import StudentsScreen from "../screens/StudentsScreen";
import { useAuth } from "../context/AuthContext";
import { canReadRoute } from "../domain/security/permissions";
import {
  partitionRoleTabs,
  type RoleTabDefinition,
} from "./roleTabPreferences";
import SomafrikBottomTabBar from "./SomafrikBottomTabBar";
import { TAB_TEST_IDS } from "../lib/loginScreenSpec";
import { tabTestIdForTabName } from "../lib/mobileNavigationSpec";
import { SOMAFRIK_TAB_ICON_DP } from "../lib/tabBarItemInnerLayout";
import { shortBottomTabLabel } from "../lib/mobileUxV1Layout";
import MobileAppHeader from "../components/MobileAppHeader";

const Tab = createBottomTabNavigator();

const hiddenTabOptions = {
  tabBarButton: () => null,
  tabBarItemStyle: { display: "none" } as const,
};

export default function BottomTabsNavigator() {
  const { session } = useAuth();
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
      tabBar={(props) => <SomafrikBottomTabBar {...props} />}
      screenOptions={({ route, navigation }) => ({
        headerShown: true,
        headerStatusBarHeight: 0,
        header: () => <MobileAppHeader navigation={navigation} />,
        safeAreaInsets: { top: 0, bottom: 0 },
        tabBarActiveTintColor: "#2563EB",
        tabBarInactiveTintColor: "#64748B",
        tabBarIcon: ({ focused, color }) => {
          if (route.name === "Accueil") {
            return (
              <Ionicons
                name={focused ? "home" : "home-outline"}
                size={SOMAFRIK_TAB_ICON_DP}
                color={color}
              />
            );
          }

          const config = findTabDefinition(route.name, visibleTabs, overflowTabs, hiddenTabs);
          const iconName = focused ? config?.focusedIcon ?? "ellipse-outline" : config?.icon ?? "ellipse-outline";

          return (
            <Ionicons
              name={iconName}
              size={SOMAFRIK_TAB_ICON_DP}
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
        const label = shortBottomTabLabel(tab.tabName, tab.label);
        return (
          <Tab.Screen
            key={tab.tabName}
            name={tab.tabName}
            component={tab.component}
            initialParams={tab.initialParams}
            options={
              tabTestId
                ? {
                    tabBarLabel: label,
                    tabBarButtonTestID: tabTestId,
                    tabBarAccessibilityLabel: label,
                  }
                : { tabBarLabel: label, tabBarAccessibilityLabel: label }
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
