import type { ComponentType } from "react";
import type { Ionicons } from "@expo/vector-icons";
import ClassesScreen from "../screens/ClassesScreen";
import UsersScreen from "../screens/UsersScreen";
import StudentsScreen from "../screens/StudentsScreen";
import TeachersScreen from "../screens/TeachersScreen";
import PaymentsScreen from "../screens/PaymentsScreen";
import StudentDetailScreen from "../screens/StudentDetailScreen";
import StudentNotesScreen from "../screens/StudentNotesScreen";
import StudentPresencesScreen from "../screens/StudentPresencesScreen";
import StudentPaymentsScreen from "../screens/StudentPaymentsScreen";
import TeacherAttendanceScreen from "../screens/TeacherAttendanceScreen";
import TeacherGradesScreen from "../screens/TeacherGradesScreen";
import PlatformNotificationsScreen from "../screens/PlatformNotificationsScreen";
import { shortBottomTabLabel } from "../lib/mobileUxV1Layout";
import {
  getRoleTabCatalog,
  partitionRoleTabCatalog,
  MAX_FLOATING_ROLE_TABS,
  type RoleTabCatalogItem,
} from "./roleTabCatalog";

export { MAX_FLOATING_ROLE_TABS, getRoleTabCatalog, partitionRoleTabCatalog };

export type RoleTabDefinition = RoleTabCatalogItem & {
  component: ComponentType<any>;
  icon: keyof typeof Ionicons.glyphMap;
  focusedIcon: keyof typeof Ionicons.glyphMap;
  quickActionIcon: keyof typeof Ionicons.glyphMap;
  initialParams?: Record<string, unknown>;
};

const SCREEN_BY_TAB: Record<string, ComponentType<any>> = {
  TeacherStudents: StudentsScreen,
  TeacherAttendance: TeacherAttendanceScreen,
  Paiements: PaymentsScreen,
  Classes: ClassesScreen,
  TeacherGrades: TeacherGradesScreen,
  Enseignants: TeachersScreen,
  Profil: StudentDetailScreen,
  Notes: StudentNotesScreen,
  Presences: StudentPresencesScreen,
  FraisEleve: StudentPaymentsScreen,
  Utilisateurs: UsersScreen,
  PlatformNotifications: PlatformNotificationsScreen,
};

const ICONS_BY_TAB: Record<
  string,
  { icon: RoleTabDefinition["icon"]; focusedIcon: RoleTabDefinition["focusedIcon"]; quickActionIcon: RoleTabDefinition["quickActionIcon"] }
> = {
  TeacherStudents: { icon: "people-outline", focusedIcon: "people", quickActionIcon: "people-outline" },
  TeacherAttendance: { icon: "checkbox-outline", focusedIcon: "checkbox", quickActionIcon: "checkbox-outline" },
  Paiements: { icon: "card-outline", focusedIcon: "card", quickActionIcon: "card-outline" },
  Classes: { icon: "grid-outline", focusedIcon: "grid", quickActionIcon: "grid-outline" },
  TeacherGrades: { icon: "reader-outline", focusedIcon: "reader", quickActionIcon: "reader-outline" },
  Enseignants: { icon: "school-outline", focusedIcon: "school", quickActionIcon: "person-add-outline" },
  Profil: { icon: "person-outline", focusedIcon: "person", quickActionIcon: "person-outline" },
  Notes: { icon: "book-outline", focusedIcon: "book", quickActionIcon: "book-outline" },
  Presences: { icon: "calendar-outline", focusedIcon: "calendar", quickActionIcon: "calendar-outline" },
  FraisEleve: { icon: "wallet-outline", focusedIcon: "wallet", quickActionIcon: "card-outline" },
  Utilisateurs: { icon: "person-outline", focusedIcon: "person", quickActionIcon: "person-circle-outline" },
  PlatformNotifications: { icon: "notifications-outline", focusedIcon: "notifications", quickActionIcon: "notifications-outline" },
};

const INITIAL_PARAMS_BY_TAB: Record<string, Record<string, unknown>> = {};

function hydrateTab(item: RoleTabCatalogItem): RoleTabDefinition {
  const icons = ICONS_BY_TAB[item.tabName];
  return {
    ...item,
    component: SCREEN_BY_TAB[item.tabName],
    icon: icons?.icon ?? "ellipse-outline",
    focusedIcon: icons?.focusedIcon ?? "ellipse",
    quickActionIcon: icons?.quickActionIcon ?? "ellipse-outline",
    initialParams: INITIAL_PARAMS_BY_TAB[item.tabName],
  };
}

export function getRoleTabDefinitions(role?: string): RoleTabDefinition[] {
  return getRoleTabCatalog(role).map(hydrateTab);
}

export function partitionRoleTabs(session: any) {
  const { visibleTabs, overflowTabs } = partitionRoleTabCatalog(session);
  return {
    visibleTabs: visibleTabs.map(hydrateTab),
    overflowTabs: overflowTabs.map(hydrateTab),
  };
}

export type QuickActionItem = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tabName: string;
};

export function buildOverflowQuickActionItems(session: any): QuickActionItem[] {
  const { overflowTabs } = partitionRoleTabs(session);
  return overflowTabs.map((tab) => ({
    icon: tab.quickActionIcon,
    label: tab.quickActionLabel,
    tabName: tab.tabName,
  }));
}

export function getTabBarLabel(tabName: string, definition?: RoleTabDefinition) {
  return shortBottomTabLabel(tabName, definition?.label);
}
