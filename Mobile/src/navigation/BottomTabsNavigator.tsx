import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

import HomeScreen from "../screens/HomeScreen";
import StudentsScreen from "../screens/StudentsScreen";
import MenuScreen from "../screens/MenuScreen";
import { useAuth } from "../context/AuthContext";
import { canReadRoute } from "../domain/security/permissions";
import {
  partitionRoleTabs,
  type RoleTabDefinition,
} from "./roleTabPreferences";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import { TAB_TEST_IDS } from "../lib/loginScreenSpec";
import { tabTestIdForTabName } from "../lib/mobileNavigationSpec";

const Tab = createBottomTabNavigator();

const hiddenTabOptions = {
  tabBarButton: () => null,
  tabBarItemStyle: { display: "none" } as const,
};

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
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: "#FFFFFF",
        tabBarInactiveTintColor: "#94A3B8",
        tabBarLabel: getTabLabel(route.name, visibleTabs, overflowTabs, hiddenTabs),
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "800",
          marginTop: 2,
        },
        tabBarStyle,
        tabBarItemStyle: {
          flex: 1,
          minWidth: 48,
          minHeight: 48,
          height: 58,
          borderRadius: 18,
          marginHorizontal: 1,
          paddingVertical: 5,
        },
        tabBarIcon: ({ focused }) => {
          if (route.name === "Accueil") {
            return (
              <Ionicons
                name={focused ? "home" : "home-outline"}
                size={24}
                color={focused ? "#FFFFFF" : "#94A3B8"}
              />
            );
          }

          if (route.name === "Menu") {
            return (
              <Ionicons
                name={focused ? "menu" : "menu-outline"}
                size={24}
                color={focused ? "#FFFFFF" : "#94A3B8"}
              />
            );
          }

          const config = findTabDefinition(route.name, visibleTabs, overflowTabs, hiddenTabs);
          const iconName = focused ? config?.focusedIcon ?? "ellipse-outline" : config?.icon ?? "ellipse-outline";

          return (
            <Ionicons
              name={iconName}
              size={24}
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
          options={
            tabTestId
              ? {
                  tabBarButtonTestID: tabTestId,
                  tabBarLabel: tab.label,
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
          options={hiddenTabOptions}
        />
      ))}
      <Tab.Screen
        name="Menu"
        component={MenuScreen}
        options={{
          tabBarLabel: "Menu",
          tabBarButtonTestID: TAB_TEST_IDS.menu,
          tabBarAccessibilityLabel: "Menu",
        }}
      />
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
  if (tabName === "Menu") return "Menu";
  const definition = findTabDefinition(tabName, visibleTabs, overflowTabs, hiddenTabs);
  return definition?.label ?? tabName;
}
