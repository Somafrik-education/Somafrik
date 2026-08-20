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
import { canReadRoute } from "../domain/security/permissions";

/** Nombre max d'onglets métier visibles (Accueil occupe le cinquième emplacement). */
export const MAX_FLOATING_ROLE_TABS = 4;

export type RoleTabDefinition = {
  tabName: string;
  route: string;
  component: ComponentType<any>;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  focusedIcon: keyof typeof Ionicons.glyphMap;
  quickActionIcon: keyof typeof Ionicons.glyphMap;
  quickActionLabel: string;
};

const schoolAdminTabs: RoleTabDefinition[] = [
  {
    tabName: "Classes",
    route: "Classes",
    component: ClassesScreen,
    label: "Classes",
    icon: "grid-outline",
    focusedIcon: "grid",
    quickActionIcon: "grid-outline",
    quickActionLabel: "Classes",
  },
  {
    tabName: "Paiements",
    route: "Payments",
    component: PaymentsScreen,
    label: "Frais",
    icon: "card-outline",
    focusedIcon: "card",
    quickActionIcon: "card-outline",
    quickActionLabel: "Paiements",
  },
  {
    tabName: "Utilisateurs",
    route: "Users",
    component: UsersScreen,
    label: "Comptes",
    icon: "person-outline",
    focusedIcon: "person",
    quickActionIcon: "person-circle-outline",
    quickActionLabel: "Utilisateurs",
  },
  {
    tabName: "Enseignants",
    route: "Teachers",
    component: TeachersScreen,
    label: "Profs",
    icon: "school-outline",
    focusedIcon: "school",
    quickActionIcon: "person-add-outline",
    quickActionLabel: "Enseignants",
  },
  {
    tabName: "TeacherAttendance",
    route: "TeacherAttendance",
    component: TeacherAttendanceScreen,
    label: "Appel",
    icon: "checkbox-outline",
    focusedIcon: "checkbox",
    quickActionIcon: "checkbox-outline",
    quickActionLabel: "Appel",
  },
  {
    tabName: "TeacherGrades",
    route: "TeacherGrades",
    component: TeacherGradesScreen,
    label: "Notes",
    icon: "reader-outline",
    focusedIcon: "reader",
    quickActionIcon: "reader-outline",
    quickActionLabel: "Notes",
  },
];

const teacherTabs: RoleTabDefinition[] = [
  {
    tabName: "Classes",
    route: "Classes",
    component: ClassesScreen,
    label: "Classes",
    icon: "grid-outline",
    focusedIcon: "grid",
    quickActionIcon: "grid-outline",
    quickActionLabel: "Classes",
  },
  {
    tabName: "TeacherStudents",
    route: "Students",
    component: StudentsScreen,
    label: "Élèves",
    icon: "people-outline",
    focusedIcon: "people",
    quickActionIcon: "people-outline",
    quickActionLabel: "Élèves",
  },
  {
    tabName: "TeacherAttendance",
    route: "TeacherAttendance",
    component: TeacherAttendanceScreen,
    label: "Appel",
    icon: "checkbox-outline",
    focusedIcon: "checkbox",
    quickActionIcon: "checkbox-outline",
    quickActionLabel: "Appel",
  },
  {
    tabName: "TeacherGrades",
    route: "TeacherGrades",
    component: TeacherGradesScreen,
    label: "Notes",
    icon: "reader-outline",
    focusedIcon: "reader",
    quickActionIcon: "reader-outline",
    quickActionLabel: "Notes",
  },
];

const parentStudentTabs: RoleTabDefinition[] = [
  {
    tabName: "Profil",
    route: "Profil",
    component: StudentDetailScreen,
    label: "Profil",
    icon: "person-outline",
    focusedIcon: "person",
    quickActionIcon: "person-outline",
    quickActionLabel: "Profil",
  },
  {
    tabName: "Notes",
    route: "Notes",
    component: StudentNotesScreen,
    label: "Notes",
    icon: "book-outline",
    focusedIcon: "book",
    quickActionIcon: "book-outline",
    quickActionLabel: "Notes",
  },
  {
    tabName: "Presences",
    route: "Presences",
    component: StudentPresencesScreen,
    label: "Présence",
    icon: "calendar-outline",
    focusedIcon: "calendar",
    quickActionIcon: "calendar-outline",
    quickActionLabel: "Présences",
  },
  {
    tabName: "FraisEleve",
    route: "FraisEleve",
    component: StudentPaymentsScreen,
    label: "Frais",
    icon: "wallet-outline",
    focusedIcon: "wallet",
    quickActionIcon: "card-outline",
    quickActionLabel: "Paiements",
  },
];

const secretaryTabs: RoleTabDefinition[] = [
  {
    tabName: "TeacherStudents",
    route: "Students",
    component: StudentsScreen,
    label: "Élèves",
    icon: "people-outline",
    focusedIcon: "people",
    quickActionIcon: "people-outline",
    quickActionLabel: "Élèves",
  },
  {
    tabName: "TeacherAttendance",
    route: "TeacherAttendance",
    component: TeacherAttendanceScreen,
    label: "Appel",
    icon: "checkbox-outline",
    focusedIcon: "checkbox",
    quickActionIcon: "checkbox-outline",
    quickActionLabel: "Présences",
  },
  {
    tabName: "Paiements",
    route: "Payments",
    component: PaymentsScreen,
    label: "Frais",
    icon: "card-outline",
    focusedIcon: "card",
    quickActionIcon: "card-outline",
    quickActionLabel: "Paiements",
  },
];

const globalAdminTabs: RoleTabDefinition[] = [
  {
    tabName: "Classes",
    route: "Classes",
    component: ClassesScreen,
    label: "Classes",
    icon: "grid-outline",
    focusedIcon: "grid",
    quickActionIcon: "grid-outline",
    quickActionLabel: "Classes",
  },
  {
    tabName: "Enseignants",
    route: "Teachers",
    component: TeachersScreen,
    label: "Profs",
    icon: "school-outline",
    focusedIcon: "school",
    quickActionIcon: "person-add-outline",
    quickActionLabel: "Enseignants",
  },
  {
    tabName: "Paiements",
    route: "Payments",
    component: PaymentsScreen,
    label: "Frais",
    icon: "card-outline",
    focusedIcon: "card",
    quickActionIcon: "card-outline",
    quickActionLabel: "Paiements",
  },
];

function getRoleTabDefinitions(role?: string): RoleTabDefinition[] {
  if (role === "parent_student" || role === "student") return parentStudentTabs;
  if (role === "teacher") return teacherTabs;
  if (role === "principal" || role === "prefet") return teacherTabs;
  if (role === "secretary") return secretaryTabs;
  if (role === "school_admin") return schoolAdminTabs;
  if (role === "super_admin" || role === "country_admin") return globalAdminTabs;
  return globalAdminTabs;
}

export function partitionRoleTabs(session: any) {
  const allowed = getRoleTabDefinitions(session?.role).filter((tab) => canReadRoute(session, tab.route));
  return {
    visibleTabs: allowed.slice(0, MAX_FLOATING_ROLE_TABS),
    overflowTabs: allowed.slice(MAX_FLOATING_ROLE_TABS),
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
  return definition?.label ?? tabName;
}
