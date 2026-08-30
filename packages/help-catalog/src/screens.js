import { HELP_PLATFORM, HELP_ROLE, HELP_SCREEN, MODULE_BY_SCREEN, normalizeHelpRole } from "./constants.js";

function asTrimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function pathnameWithoutQuery(pathname) {
  const raw = asTrimmed(pathname).split("?")[0];
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw || "/";
}

const WEB_NULL_PATHS = Object.freeze(["/", "/connexion"]);

const MOBILE_NULL_ROUTES = Object.freeze([
  "Welcome",
  "RoleSelection",
  "Login",
  "Support",
  "Permissions",
  "PermissionsBootstrap",
  "ConfigurationError",
  "ConfigurationErrorScreen",
]);

const MOBILE_ROUTE_SCREENS = Object.freeze(
  Object.assign(Object.create(null), {
    Home: HELP_SCREEN.DASHBOARD,
    HomeTabs: HELP_SCREEN.DASHBOARD,
    Classes: HELP_SCREEN.CLASSES,
    Students: HELP_SCREEN.STUDENTS,
    TeacherStudents: HELP_SCREEN.STUDENTS,
    StudentDetail: HELP_SCREEN.STUDENTS,
    Teachers: HELP_SCREEN.TEACHERS,
    Users: HELP_SCREEN.USERS,
    TeacherAttendance: HELP_SCREEN.ATTENDANCE,
    Presences: HELP_SCREEN.ATTENDANCE,
    TeacherGrades: HELP_SCREEN.GRADES,
    Notes: HELP_SCREEN.GRADES,
    StudentNotes: HELP_SCREEN.GRADES,
    StudentPresences: HELP_SCREEN.ATTENDANCE,
    Payments: HELP_SCREEN.PAYMENTS,
    Paiements: HELP_SCREEN.PAYMENTS,
    StudentPayments: HELP_SCREEN.PAYMENTS,
    FraisEleve: HELP_SCREEN.PAYMENTS,
    Timetable: HELP_SCREEN.PLANNING,
    Messages: HELP_SCREEN.MESSAGES,
    Announcements: HELP_SCREEN.ANNOUNCEMENTS,
    InternalNotifications: HELP_SCREEN.NOTIFICATIONS,
    PlatformNotifications: HELP_SCREEN.NOTIFICATIONS,
    Configuration: HELP_SCREEN.SETTINGS,
    EstablishmentProfile: HELP_SCREEN.SETTINGS,
    SchoolYearSettings: HELP_SCREEN.SETTINGS,
    SchoolPedagogicalStructure: HELP_SCREEN.SETTINGS,
    SchoolAssignableRoles: HELP_SCREEN.SETTINGS,
    Synchronization: HELP_SCREEN.SYNC,
    OfflineMode: HELP_SCREEN.SYNC,
  }),
);

function resolveWebScreen(pathname) {
  const path = pathnameWithoutQuery(pathname);
  if (WEB_NULL_PATHS.includes(path)) return null;
  if (path.startsWith("/connexion")) return null;

  if (/^\/etablissement\/classes\/[^/]+\/eleves/.test(path)) return HELP_SCREEN.STUDENTS;
  if (path.startsWith("/etablissement/classes")) return HELP_SCREEN.CLASSES;
  if (path.startsWith("/etablissement/eleves")) return HELP_SCREEN.STUDENTS;
  if (path.startsWith("/etablissement/enseignants")) return HELP_SCREEN.TEACHERS;
  if (path.startsWith("/etablissement/comptes-utilisateurs")) return HELP_SCREEN.USERS;
  if (path.startsWith("/etablissement")) return HELP_SCREEN.DASHBOARD;
  if (path.startsWith("/administration")) return HELP_SCREEN.USERS;
  if (path.startsWith("/tableau-de-bord")) return HELP_SCREEN.DASHBOARD;
  if (path.startsWith("/presences")) return HELP_SCREEN.ATTENDANCE;
  if (path.startsWith("/notes")) return HELP_SCREEN.GRADES;
  if (path.startsWith("/finances")) return HELP_SCREEN.PAYMENTS;
  if (path.startsWith("/planning")) return HELP_SCREEN.PLANNING;
  if (path.startsWith("/notifications")) return HELP_SCREEN.NOTIFICATIONS;
  if (path.startsWith("/parametres")) return HELP_SCREEN.SETTINGS;
  if (path.startsWith("/messages")) return HELP_SCREEN.MESSAGES;
  if (path.startsWith("/annonces")) return HELP_SCREEN.ANNOUNCEMENTS;
  return null;
}

function resolveMobileHomeScreen(roleKey) {
  if (roleKey === HELP_ROLE.PARENT) return HELP_SCREEN.PARENT_HOME;
  if (roleKey === HELP_ROLE.STUDENT) return HELP_SCREEN.STUDENT_HOME;
  return HELP_SCREEN.DASHBOARD;
}

function resolveMobileScreen(routeName, roleKey) {
  const name = asTrimmed(routeName);
  if (!name || MOBILE_NULL_ROUTES.includes(name)) return null;
  if (name === "Home" || name === "HomeTabs") return resolveMobileHomeScreen(roleKey);
  return Object.hasOwn(MOBILE_ROUTE_SCREENS, name) ? Reflect.get(MOBILE_ROUTE_SCREENS, name) : null;
}

export function resolveHelpScreen(input = {}) {
  const platform = asTrimmed(input.platform);
  const roleKey = normalizeHelpRole(input.role);

  if (platform === HELP_PLATFORM.WEB) {
    return resolveWebScreen(input.pathname);
  }
  if (platform === HELP_PLATFORM.MOBILE) {
    return resolveMobileScreen(input.routeName, roleKey);
  }
  return null;
}

export function moduleForScreen(screen) {
  if (typeof screen !== "string") return null;
  return Object.hasOwn(MODULE_BY_SCREEN, screen) ? Reflect.get(MODULE_BY_SCREEN, screen) : null;
}
