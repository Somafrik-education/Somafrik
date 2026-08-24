import { canReadRoute } from "../domain/security/permissions";

/** Nombre max d'onglets métier visibles (Accueil occupe le cinquième emplacement). */
export const MAX_FLOATING_ROLE_TABS = 4;

export type RoleTabCatalogItem = {
  tabName: string;
  route: string;
  label: string;
  quickActionLabel: string;
};

const schoolAdminTabs: RoleTabCatalogItem[] = [
  { tabName: "TeacherStudents", route: "Students", label: "Élèves", quickActionLabel: "Élèves" },
  { tabName: "TeacherAttendance", route: "TeacherAttendance", label: "Appel", quickActionLabel: "Présences" },
  { tabName: "Paiements", route: "Payments", label: "Frais", quickActionLabel: "Paiements" },
  { tabName: "Classes", route: "Classes", label: "Classes", quickActionLabel: "Classes" },
  { tabName: "TeacherGrades", route: "TeacherGrades", label: "Notes", quickActionLabel: "Notes" },
  { tabName: "Enseignants", route: "Teachers", label: "Profs", quickActionLabel: "Enseignants" },
];

const teacherTabs: RoleTabCatalogItem[] = [
  { tabName: "Classes", route: "Classes", label: "Classes", quickActionLabel: "Classes" },
  { tabName: "TeacherStudents", route: "Students", label: "Élèves", quickActionLabel: "Élèves" },
  { tabName: "TeacherAttendance", route: "TeacherAttendance", label: "Appel", quickActionLabel: "Présences" },
  { tabName: "TeacherGrades", route: "TeacherGrades", label: "Notes", quickActionLabel: "Notes" },
];

const parentStudentTabs: RoleTabCatalogItem[] = [
  { tabName: "Profil", route: "Profil", label: "Profil", quickActionLabel: "Profil" },
  { tabName: "Notes", route: "Notes", label: "Notes", quickActionLabel: "Notes" },
  { tabName: "Presences", route: "Presences", label: "Présence", quickActionLabel: "Présences" },
  { tabName: "FraisEleve", route: "FraisEleve", label: "Frais", quickActionLabel: "Paiements" },
];

const secretaryTabs: RoleTabCatalogItem[] = [
  { tabName: "TeacherStudents", route: "Students", label: "Élèves", quickActionLabel: "Élèves" },
  { tabName: "TeacherAttendance", route: "TeacherAttendance", label: "Appel", quickActionLabel: "Présences" },
  { tabName: "Paiements", route: "Payments", label: "Frais", quickActionLabel: "Paiements" },
  { tabName: "Classes", route: "Classes", label: "Classes", quickActionLabel: "Classes" },
];

const accountantTabs: RoleTabCatalogItem[] = [
  { tabName: "Paiements", route: "Payments", label: "Frais", quickActionLabel: "Paiements" },
  { tabName: "TeacherStudents", route: "Students", label: "Élèves", quickActionLabel: "Élèves" },
];

const platformTabs: RoleTabCatalogItem[] = [
  { tabName: "Utilisateurs", route: "Users", label: "Comptes", quickActionLabel: "Utilisateurs" },
  { tabName: "PlatformNotifications", route: "PlatformNotifications", label: "Notifs", quickActionLabel: "Notifications" },
];

export function getRoleTabCatalog(role?: string): RoleTabCatalogItem[] {
  if (role === "parent_student" || role === "student") return parentStudentTabs;
  if (role === "teacher") return teacherTabs;
  if (role === "principal" || role === "prefet" || role === "proviseur") return teacherTabs;
  if (role === "secretary") return secretaryTabs;
  if (role === "accountant") return accountantTabs;
  if (role === "school_admin") return schoolAdminTabs;
  if (role === "super_admin" || role === "country_admin") return platformTabs;
  return secretaryTabs;
}

export function partitionRoleTabCatalog(session: any) {
  const allowed = getRoleTabCatalog(session?.role).filter((tab) => canReadRoute(session, tab.route));
  return {
    visibleTabs: allowed.slice(0, MAX_FLOATING_ROLE_TABS),
    overflowTabs: allowed.slice(MAX_FLOATING_ROLE_TABS),
  };
}
