import type { Ionicons } from "@expo/vector-icons";
import type { AdminEntity } from "../context/AdminDataContext";
import { canReadEntity, canReadRoute, canReadView } from "../domain/security/permissions";
import { canAccessMessagesRoute } from "../lib/mobileCtaRbacAlignment";
import { ENTITY_VIEW_MAP } from "../lib/constants";

export type DrawerSectionId = "quotidien" | "admin" | "outils";

export type RoleDrawerItem = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route?: string;
  entity?: AdminEntity;
  view?: string;
  section?: DrawerSectionId;
};

export const DRAWER_SECTION_TITLES: Record<DrawerSectionId, string> = {
  quotidien: "Quotidien",
  admin: "Admin",
  outils: "Outils",
};

const DRAWER_SECTION_ORDER: DrawerSectionId[] = ["quotidien", "admin", "outils"];

function quotidien(item: RoleDrawerItem): RoleDrawerItem {
  return { ...item, section: "quotidien" };
}

function admin(item: RoleDrawerItem): RoleDrawerItem {
  return { ...item, section: "admin" };
}

function outils(item: RoleDrawerItem): RoleDrawerItem {
  return { ...item, section: "outils" };
}

const I = {
  students: { label: "Élèves", icon: "people-outline" as const, route: "Students", view: "students" },
  teacherStudents: { label: "Mes élèves", icon: "people-outline" as const, route: "TeacherStudents", view: "TeacherStudents" },
  classes: { label: "Classes", icon: "grid-outline" as const, route: "Classes", view: "classes" },
  teacherClasses: { label: "Mes classes", icon: "grid-outline" as const, route: "Classes", view: "Classes" },
  teachers: { label: "Enseignants", icon: "school-outline" as const, route: "Teachers", view: "teachers" },
  users: { label: "Utilisateurs", icon: "person-circle-outline" as const, route: "Users", view: "users" },
  platformUsers: { label: "Utilisateurs", icon: "people-outline" as const, route: "Users", view: "users" },
  payments: { label: "Paiements", icon: "card-outline" as const, route: "Payments", view: "payments" },
  studentPayments: { label: "Paiements", icon: "card-outline" as const, route: "StudentPayments", view: "StudentPayments" },
  mobilePayment: { label: "Paiements", icon: "phone-portrait-outline" as const, route: "MobilePayment", view: "MobilePayment" },
  attendance: { label: "Présences", icon: "checkbox-outline" as const, route: "TeacherAttendance", view: "TeacherAttendance" },
  studentNotes: { label: "Notes", icon: "book-outline" as const, route: "StudentNotes", view: "StudentNotes" },
  studentPresences: { label: "Présences", icon: "calendar-outline" as const, route: "StudentPresences", view: "StudentPresences" },
  grades: { label: "Notes", icon: "reader-outline" as const, route: "TeacherGrades", view: "TeacherGrades" },
  timetable: { label: "Emploi du temps", icon: "calendar-outline" as const, route: "Timetable", view: "Timetable" },
  reportCards: { label: "Bulletins", icon: "document-text-outline" as const, route: "ReportCards", view: "ReportCards" },
  announcements: { label: "Annonces", icon: "megaphone-outline" as const, route: "Announcements", view: "Announcements" },
  messages: { label: "Messages", icon: "chatbubbles-outline" as const, route: "Messages", view: "Messages" },
  documents: { label: "Documents", icon: "folder-open-outline" as const, route: "Documents", view: "Documents" },
  reports: { label: "Rapports", icon: "bar-chart-outline" as const, route: "Reports", view: "Reports" },
  sync: { label: "Synchronisation", icon: "sync-outline" as const, route: "Synchronization", view: "Synchronization" },
  offline: { label: "Mode hors ligne", icon: "cloud-offline-outline" as const, route: "OfflineMode", view: "OfflineMode" },
  support: { label: "Support", icon: "help-circle-outline" as const, route: "Support", view: "Support" },
  settings: { label: "Paramètres", icon: "settings-outline" as const, route: "Configuration", view: "Configuration" },
  structure: { label: "Structure pédagogique", icon: "layers-outline" as const, route: "SchoolPedagogicalStructure", view: "SchoolPedagogicalStructure" },
  schools: { label: "Établissements", icon: "business-outline" as const, entity: "schools" as const, view: "schools" },
  subscriptions: { label: "Abonnements", icon: "albums-outline" as const, entity: "subscriptions" as const, view: "subscriptions" },
  platformNotifications: { label: "Notifications", icon: "notifications-outline" as const, route: "PlatformNotifications", view: "PlatformNotifications" },
  internalNotifications: { label: "Notifications", icon: "notifications-outline" as const, route: "InternalNotifications", view: "InternalNotifications" },
  permissions: { label: "Droits par rôle", icon: "shield-checkmark-outline" as const, route: "Permissions", view: "Permissions" },
  audit: { label: "Audit", icon: "finger-print-outline" as const, route: "Audit", view: "Audit" },
};

const platformItems: RoleDrawerItem[] = [
  quotidien(I.schools),
  quotidien(I.subscriptions),
  quotidien(I.platformUsers),
  quotidien(I.platformNotifications),
  admin(I.permissions),
  admin(I.settings),
  admin(I.reports),
  admin(I.audit),
  admin(I.support),
];

const schoolAdminItems: RoleDrawerItem[] = [
  quotidien(I.students),
  quotidien(I.classes),
  quotidien(I.attendance),
  quotidien(I.payments),
  quotidien(I.teachers),
  quotidien(I.grades),
  quotidien(I.timetable),
  admin(I.users),
  admin(I.reportCards),
  admin(I.announcements),
  admin(I.messages),
  admin(I.internalNotifications),
  admin(I.documents),
  admin(I.reports),
  admin(I.structure),
  admin(I.settings),
  admin(I.sync),
  admin(I.offline),
  admin(I.support),
];

const prefetItems: RoleDrawerItem[] = [
  quotidien(I.students),
  quotidien(I.classes),
  quotidien(I.attendance),
  quotidien(I.grades),
  quotidien(I.timetable),
  quotidien(I.teachers),
  quotidien(I.reportCards),
  quotidien(I.payments),
  quotidien(I.messages),
  quotidien(I.announcements),
  quotidien(I.internalNotifications),
  admin(I.users),
  admin(I.documents),
  admin(I.reports),
  admin(I.structure),
  admin(I.settings),
  admin(I.sync),
  admin(I.offline),
  admin(I.support),
];

const principalItems: RoleDrawerItem[] = [
  quotidien(I.students),
  quotidien(I.classes),
  quotidien(I.attendance),
  quotidien(I.payments),
  quotidien(I.grades),
  quotidien(I.timetable),
  quotidien(I.teachers),
  quotidien(I.reportCards),
  quotidien(I.messages),
  quotidien(I.announcements),
  quotidien(I.internalNotifications),
  admin(I.users),
  admin(I.documents),
  admin(I.reports),
  admin(I.structure),
  admin(I.settings),
  admin(I.sync),
  admin(I.offline),
  admin(I.support),
];

const secretaryItems: RoleDrawerItem[] = [
  quotidien(I.students),
  quotidien(I.attendance),
  quotidien(I.payments),
  quotidien(I.classes),
  quotidien(I.teachers),
  quotidien(I.messages),
  quotidien(I.announcements),
  quotidien(I.internalNotifications),
  quotidien(I.documents),
  quotidien(I.reportCards),
  admin(I.users),
  admin(I.grades),
  admin(I.timetable),
  admin(I.reports),
  admin(I.structure),
  admin(I.settings),
  admin(I.sync),
  admin(I.offline),
  admin(I.support),
];

const accountantItems: RoleDrawerItem[] = [
  quotidien(I.payments),
  quotidien(I.students),
  quotidien(I.messages),
  quotidien(I.announcements),
  quotidien(I.internalNotifications),
  quotidien(I.documents),
  quotidien(I.reports),
  admin(I.classes),
  admin(I.attendance),
  admin(I.teachers),
  admin(I.users),
  admin(I.grades),
  admin(I.timetable),
  admin(I.reportCards),
  admin(I.structure),
  admin(I.settings),
  admin(I.sync),
  admin(I.offline),
  admin(I.support),
];

const adjointItems: RoleDrawerItem[] = [
  quotidien(I.attendance),
  quotidien(I.students),
  quotidien(I.classes),
  quotidien(I.messages),
  quotidien(I.announcements),
  quotidien(I.internalNotifications),
  quotidien(I.teachers),
  quotidien(I.grades),
  quotidien(I.timetable),
  quotidien(I.payments),
  quotidien(I.reportCards),
  admin(I.users),
  admin(I.documents),
  admin(I.reports),
  admin(I.structure),
  admin(I.settings),
  admin(I.sync),
  admin(I.offline),
  admin(I.support),
];

const supervisorItems: RoleDrawerItem[] = [
  quotidien(I.attendance),
  quotidien(I.students),
  quotidien(I.classes),
  quotidien(I.messages),
  quotidien(I.announcements),
  quotidien(I.internalNotifications),
  quotidien(I.teachers),
  quotidien(I.grades),
  quotidien(I.timetable),
  quotidien(I.reportCards),
  quotidien(I.payments),
  admin(I.users),
  admin(I.documents),
  admin(I.reports),
  admin(I.structure),
  admin(I.settings),
  admin(I.sync),
  admin(I.offline),
  admin(I.support),
];

const teacherItems: RoleDrawerItem[] = [
  quotidien(I.teacherClasses),
  quotidien({ ...I.attendance, label: "Présences" }),
  quotidien(I.grades),
  quotidien(I.teacherStudents),
  quotidien(I.timetable),
  quotidien(I.reportCards),
  quotidien(I.messages),
  quotidien(I.announcements),
  quotidien(I.internalNotifications),
  outils(I.sync),
  outils(I.support),
];

const parentItems: RoleDrawerItem[] = [
  quotidien(I.studentNotes),
  quotidien(I.studentPresences),
  quotidien(I.reportCards),
  quotidien(I.mobilePayment),
  quotidien(I.messages),
  quotidien(I.announcements),
  quotidien(I.internalNotifications),
  quotidien(I.timetable),
  outils(I.offline),
  outils(I.support),
];

const studentItems: RoleDrawerItem[] = [
  quotidien(I.studentNotes),
  quotidien(I.studentPresences),
  quotidien(I.timetable),
  quotidien(I.reportCards),
  quotidien(I.messages),
  quotidien(I.announcements),
  quotidien(I.internalNotifications),
  quotidien(I.studentPayments),
  outils(I.offline),
  outils(I.support),
];

export function getRoleDrawerCatalog(role?: string): RoleDrawerItem[] {
  if (role === "super_admin" || role === "country_admin") return platformItems;
  if (role === "school_admin") return schoolAdminItems;
  if (role === "prefet") return prefetItems;
  if (role === "principal" || role === "proviseur") return principalItems;
  if (role === "secretary") return secretaryItems;
  if (role === "accountant") return accountantItems;
  if (role === "adjoint") return adjointItems;
  if (role === "supervisor") return supervisorItems;
  if (role === "teacher") return teacherItems;
  if (role === "parent_student") return parentItems;
  if (role === "student") return studentItems;
  return adjointItems;
}

export function isRoleDrawerItemAllowed(session: any, item: RoleDrawerItem): boolean {
  if (item.route === "Messages" || item.view === "Messages") {
    return canAccessMessagesRoute(session);
  }
  const view = item.view ?? (item.entity ? ENTITY_VIEW_MAP[item.entity] : item.route);
  if (view && !canReadView(session, view)) return false;
  if (item.entity && !canReadEntity(session, item.entity)) return false;
  if (item.route && !canReadRoute(session, item.route)) return false;
  return true;
}

export function getAllowedRoleDrawerItems(session: any): RoleDrawerItem[] {
  return getRoleDrawerCatalog(session?.role).filter((item) => isRoleDrawerItemAllowed(session, item));
}

export function getAllowedRoleDrawerSections(session: any): { id: DrawerSectionId; title: string; items: RoleDrawerItem[] }[] {
  const items = getAllowedRoleDrawerItems(session);
  return DRAWER_SECTION_ORDER.map((id) => ({
    id,
    title: DRAWER_SECTION_TITLES[id],
    items: items.filter((item) => (item.section ?? "quotidien") === id),
  })).filter((section) => section.items.length > 0);
}
