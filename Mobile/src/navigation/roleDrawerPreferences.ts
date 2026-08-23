import type { Ionicons } from "@expo/vector-icons";
import type { AdminEntity } from "../context/AdminDataContext";
import { canReadEntity, canReadRoute, canReadView } from "../domain/security/permissions";
import { canAccessMessagesRoute } from "../lib/mobileCtaRbacAlignment";
import { ENTITY_VIEW_MAP } from "../lib/constants";

export type RoleDrawerItem = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route?: string;
  entity?: AdminEntity;
  view?: string;
};

const platformItems: RoleDrawerItem[] = [
  { label: "Établissements", icon: "business-outline", entity: "schools", view: "schools" },
  { label: "Abonnements", icon: "albums-outline", entity: "subscriptions", view: "subscriptions" },
  { label: "Utilisateurs", icon: "people-outline", route: "Users", view: "users" },
  { label: "Enseignants", icon: "school-outline", route: "Teachers", view: "teachers" },
  { label: "Classes", icon: "grid-outline", route: "Classes", view: "classes" },
  { label: "Paiements", icon: "card-outline", route: "Payments", view: "payments" },
  { label: "Notifications plateforme", icon: "notifications-outline", route: "PlatformNotifications", view: "PlatformNotifications" },
  { label: "Droits par rôle", icon: "shield-checkmark-outline", route: "Permissions", view: "Permissions" },
  { label: "Paramètres", icon: "settings-outline", route: "Configuration", view: "Configuration" },
  { label: "Rapports", icon: "bar-chart-outline", route: "Reports", view: "Reports" },
  { label: "Audit", icon: "finger-print-outline", route: "Audit", view: "Audit" },
  { label: "Support", icon: "help-circle-outline", route: "Support", view: "Support" },
];

const schoolStaffItems: RoleDrawerItem[] = [
  { label: "Élèves", icon: "people-outline", route: "Students", view: "students" },
  { label: "Classes", icon: "grid-outline", route: "Classes", view: "classes" },
  { label: "Enseignants", icon: "school-outline", route: "Teachers", view: "teachers" },
  { label: "Utilisateurs", icon: "person-circle-outline", route: "Users", view: "users" },
  { label: "Paramètres", icon: "settings-outline", route: "Configuration", view: "Configuration" },
  { label: "Structure pédagogique", icon: "layers-outline", route: "SchoolPedagogicalStructure", view: "SchoolPedagogicalStructure" },
  { label: "Paiements", icon: "card-outline", route: "Payments", view: "payments" },
  { label: "Présences", icon: "checkbox-outline", route: "TeacherAttendance", view: "TeacherAttendance" },
  { label: "Notes", icon: "reader-outline", route: "TeacherGrades", view: "TeacherGrades" },
  { label: "Emploi du temps", icon: "calendar-outline", route: "Timetable", view: "Timetable" },
  { label: "Bulletins", icon: "document-text-outline", route: "ReportCards", view: "ReportCards" },
  { label: "Annonces", icon: "megaphone-outline", route: "Announcements", view: "Announcements" },
  { label: "Messages", icon: "chatbubbles-outline", route: "Messages", view: "Messages" },
  { label: "Documents", icon: "folder-open-outline", route: "Documents", view: "Documents" },
  { label: "Rapports", icon: "bar-chart-outline", route: "Reports", view: "Reports" },
  { label: "Synchronisation", icon: "sync-outline", route: "Synchronization", view: "Synchronization" },
  { label: "Mode hors ligne", icon: "cloud-offline-outline", route: "OfflineMode", view: "OfflineMode" },
  { label: "Support", icon: "help-circle-outline", route: "Support", view: "Support" },
];

const teacherItems: RoleDrawerItem[] = [
  { label: "Mes classes", icon: "grid-outline", route: "Classes", view: "Classes" },
  { label: "Mes élèves", icon: "people-outline", route: "TeacherStudents", view: "TeacherStudents" },
  { label: "Appel", icon: "checkbox-outline", route: "TeacherAttendance", view: "TeacherAttendance" },
  { label: "Notes", icon: "reader-outline", route: "TeacherGrades", view: "TeacherGrades" },
  { label: "Emploi du temps", icon: "calendar-outline", route: "Timetable", view: "Timetable" },
  { label: "Bulletins", icon: "document-text-outline", route: "ReportCards", view: "ReportCards" },
  { label: "Annonces", icon: "megaphone-outline", route: "Announcements", view: "Announcements" },
  { label: "Messages", icon: "chatbubbles-outline", route: "Messages", view: "Messages" },
  { label: "Synchronisation", icon: "sync-outline", route: "Synchronization", view: "Synchronization" },
  { label: "Support", icon: "help-circle-outline", route: "Support", view: "Support" },
];

const parentItems: RoleDrawerItem[] = [
  { label: "Bulletins", icon: "document-text-outline", route: "ReportCards", view: "ReportCards" },
  { label: "Messages", icon: "chatbubbles-outline", route: "Messages", view: "Messages" },
  { label: "Annonces", icon: "megaphone-outline", route: "Announcements", view: "Announcements" },
  { label: "Paiement mobile", icon: "phone-portrait-outline", route: "MobilePayment", view: "MobilePayment" },
  { label: "Mode hors ligne", icon: "cloud-offline-outline", route: "OfflineMode", view: "OfflineMode" },
  { label: "Support", icon: "help-circle-outline", route: "Support", view: "Support" },
];

const studentItems: RoleDrawerItem[] = [
  { label: "Emploi du temps", icon: "calendar-outline", route: "Timetable", view: "Timetable" },
  { label: "Bulletins", icon: "document-text-outline", route: "ReportCards", view: "ReportCards" },
  { label: "Messages", icon: "chatbubbles-outline", route: "Messages", view: "Messages" },
  { label: "Annonces", icon: "megaphone-outline", route: "Announcements", view: "Announcements" },
  { label: "Mode hors ligne", icon: "cloud-offline-outline", route: "OfflineMode", view: "OfflineMode" },
  { label: "Support", icon: "help-circle-outline", route: "Support", view: "Support" },
];

function itemsForRole(role?: string): RoleDrawerItem[] {
  if (role === "super_admin" || role === "country_admin") return platformItems;
  if (role === "teacher") return teacherItems;
  if (role === "parent_student") return parentItems;
  if (role === "student") return studentItems;
  return schoolStaffItems;
}

export function getAllowedRoleDrawerItems(session: any): RoleDrawerItem[] {
  return itemsForRole(session?.role).filter((item) => {
    if (item.route === "Messages" || item.view === "Messages") {
      return canAccessMessagesRoute(session);
    }
    const view = item.view ?? (item.entity ? ENTITY_VIEW_MAP[item.entity] : item.route);
    if (view && !canReadView(session, view)) return false;
    if (item.entity && !canReadEntity(session, item.entity)) return false;
    if (item.route && !canReadRoute(session, item.route)) return false;
    return true;
  });
}
