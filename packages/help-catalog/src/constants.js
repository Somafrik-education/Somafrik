export const HELP_PLATFORM = Object.freeze({
  WEB: "web",
  MOBILE: "mobile",
});

export const HELP_SCREEN = Object.freeze({
  DASHBOARD: "dashboard",
  CLASSES: "classes",
  STUDENTS: "students",
  TEACHERS: "teachers",
  USERS: "users",
  ATTENDANCE: "attendance",
  GRADES: "grades",
  PAYMENTS: "payments",
  PLANNING: "planning",
  MESSAGES: "messages",
  ANNOUNCEMENTS: "announcements",
  NOTIFICATIONS: "notifications",
  SETTINGS: "settings",
  SETTINGS_PROFILE: "settings-profile",
  SETTINGS_ACADEMIC_YEAR: "settings-academic-year",
  SETTINGS_STRUCTURE: "settings-structure",
  SETTINGS_ROLES: "settings-roles",
  SETTINGS_FINANCE: "settings-finance",
  SETTINGS_DATA: "settings-data",
  SETTINGS_SECURITY: "settings-security",
  SETTINGS_SUBSCRIPTION: "settings-subscription",
  SETTINGS_COMING_SOON: "settings-coming-soon",
  PARENT_HOME: "parent-home",
  STUDENT_HOME: "student-home",
  SYNC: "sync",
});

export const HELP_MODULE = Object.freeze({
  DASHBOARD: "dashboard",
  ETABLISSEMENT: "etablissement",
  PEDAGOGIE: "pedagogie",
  FINANCES: "finances",
  COMMUNICATION: "communication",
  PARAMETRES: "parametres",
  ACCUEIL: "accueil",
  SYNC: "sync",
});

export const MODULE_BY_SCREEN = Object.freeze(
  Object.assign(Object.create(null), {
    [HELP_SCREEN.DASHBOARD]: HELP_MODULE.DASHBOARD,
    [HELP_SCREEN.CLASSES]: HELP_MODULE.ETABLISSEMENT,
    [HELP_SCREEN.STUDENTS]: HELP_MODULE.ETABLISSEMENT,
    [HELP_SCREEN.TEACHERS]: HELP_MODULE.ETABLISSEMENT,
    [HELP_SCREEN.USERS]: HELP_MODULE.ETABLISSEMENT,
    [HELP_SCREEN.ATTENDANCE]: HELP_MODULE.PEDAGOGIE,
    [HELP_SCREEN.GRADES]: HELP_MODULE.PEDAGOGIE,
    [HELP_SCREEN.PAYMENTS]: HELP_MODULE.FINANCES,
    [HELP_SCREEN.PLANNING]: HELP_MODULE.PEDAGOGIE,
    [HELP_SCREEN.MESSAGES]: HELP_MODULE.COMMUNICATION,
    [HELP_SCREEN.ANNOUNCEMENTS]: HELP_MODULE.COMMUNICATION,
    [HELP_SCREEN.NOTIFICATIONS]: HELP_MODULE.COMMUNICATION,
    [HELP_SCREEN.SETTINGS]: HELP_MODULE.PARAMETRES,
    [HELP_SCREEN.SETTINGS_PROFILE]: HELP_MODULE.PARAMETRES,
    [HELP_SCREEN.SETTINGS_ACADEMIC_YEAR]: HELP_MODULE.PARAMETRES,
    [HELP_SCREEN.SETTINGS_STRUCTURE]: HELP_MODULE.PARAMETRES,
    [HELP_SCREEN.SETTINGS_ROLES]: HELP_MODULE.PARAMETRES,
    [HELP_SCREEN.SETTINGS_FINANCE]: HELP_MODULE.PARAMETRES,
    [HELP_SCREEN.SETTINGS_DATA]: HELP_MODULE.PARAMETRES,
    [HELP_SCREEN.SETTINGS_SECURITY]: HELP_MODULE.PARAMETRES,
    [HELP_SCREEN.SETTINGS_SUBSCRIPTION]: HELP_MODULE.PARAMETRES,
    [HELP_SCREEN.SETTINGS_COMING_SOON]: HELP_MODULE.PARAMETRES,
    [HELP_SCREEN.PARENT_HOME]: HELP_MODULE.ACCUEIL,
    [HELP_SCREEN.STUDENT_HOME]: HELP_MODULE.ACCUEIL,
    [HELP_SCREEN.SYNC]: HELP_MODULE.SYNC,
  }),
);

export const HELP_ROLE = Object.freeze({
  SUPER_ADMIN: "SUPER_ADMIN",
  COUNTRY_ADMIN: "COUNTRY_ADMIN",
  SCHOOL_ADMIN: "SCHOOL_ADMIN",
  PRINCIPAL: "PRINCIPAL",
  PROVISEUR: "PROVISEUR",
  PREFET_ETUDES: "PREFET_ETUDES",
  SECRETARY: "SECRETARY",
  ACCOUNTANT: "ACCOUNTANT",
  SUPERVISOR: "SUPERVISOR",
  TEACHER: "TEACHER",
  PARENT: "PARENT",
  STUDENT: "STUDENT",
});

export const SCHOOL_STAFF_ROLES = Object.freeze([
  HELP_ROLE.SCHOOL_ADMIN,
  HELP_ROLE.PRINCIPAL,
  HELP_ROLE.PROVISEUR,
  HELP_ROLE.PREFET_ETUDES,
  HELP_ROLE.SECRETARY,
  HELP_ROLE.ACCOUNTANT,
  HELP_ROLE.SUPERVISOR,
  HELP_ROLE.TEACHER,
]);

export const ESTABLISHMENT_ADMIN_ROLES = Object.freeze([
  HELP_ROLE.SCHOOL_ADMIN,
  HELP_ROLE.PRINCIPAL,
  HELP_ROLE.PROVISEUR,
  HELP_ROLE.PREFET_ETUDES,
  HELP_ROLE.SECRETARY,
]);

/** Opérateur Paramètres établissement (SETTINGS-01) : Admin School uniquement. */
export const SCHOOL_SETTINGS_ROLES = Object.freeze([HELP_ROLE.SCHOOL_ADMIN]);

export const AUTHENTICATED_HELP_ROLES = Object.freeze([
  ...SCHOOL_STAFF_ROLES,
  HELP_ROLE.PARENT,
  HELP_ROLE.STUDENT,
  HELP_ROLE.SUPER_ADMIN,
  HELP_ROLE.COUNTRY_ADMIN,
]);

const ROLE_ALIASES = Object.freeze(
  Object.assign(Object.create(null), {
    super_admin: HELP_ROLE.SUPER_ADMIN,
    "super admin": HELP_ROLE.SUPER_ADMIN,
    "super administrateur somafrik": HELP_ROLE.SUPER_ADMIN,
    "super administrateur": HELP_ROLE.SUPER_ADMIN,
    "super administrateur okafric": HELP_ROLE.SUPER_ADMIN,
    country_admin: HELP_ROLE.COUNTRY_ADMIN,
    "admin pays": HELP_ROLE.COUNTRY_ADMIN,
    "administrateur pays": HELP_ROLE.COUNTRY_ADMIN,
    school_admin: HELP_ROLE.SCHOOL_ADMIN,
    "admin school": HELP_ROLE.SCHOOL_ADMIN,
    "admin etablissement": HELP_ROLE.SCHOOL_ADMIN,
    "administrateur ecole": HELP_ROLE.SCHOOL_ADMIN,
    "administrateur etablissement": HELP_ROLE.SCHOOL_ADMIN,
    "administrateur d etablissement": HELP_ROLE.SCHOOL_ADMIN,
    teacher: HELP_ROLE.TEACHER,
    enseignant: HELP_ROLE.TEACHER,
    parent: HELP_ROLE.PARENT,
    parent_student: HELP_ROLE.PARENT,
    student: HELP_ROLE.STUDENT,
    eleve: HELP_ROLE.STUDENT,
    etudiant: HELP_ROLE.STUDENT,
    "eleve / etudiant": HELP_ROLE.STUDENT,
    secretary: HELP_ROLE.SECRETARY,
    secretaire: HELP_ROLE.SECRETARY,
    accountant: HELP_ROLE.ACCOUNTANT,
    comptable: HELP_ROLE.ACCOUNTANT,
    prefet: HELP_ROLE.PREFET_ETUDES,
    "prefet des etudes": HELP_ROLE.PREFET_ETUDES,
    principal: HELP_ROLE.PRINCIPAL,
    directeur: HELP_ROLE.PRINCIPAL,
    adjoint: HELP_ROLE.PRINCIPAL,
    "directeur adjoint": HELP_ROLE.PRINCIPAL,
    proviseur: HELP_ROLE.PROVISEUR,
    supervisor: HELP_ROLE.SUPERVISOR,
    surveillant: HELP_ROLE.SUPERVISOR,
    [HELP_ROLE.SUPER_ADMIN.toLowerCase()]: HELP_ROLE.SUPER_ADMIN,
    [HELP_ROLE.COUNTRY_ADMIN.toLowerCase()]: HELP_ROLE.COUNTRY_ADMIN,
    [HELP_ROLE.SCHOOL_ADMIN.toLowerCase()]: HELP_ROLE.SCHOOL_ADMIN,
    [HELP_ROLE.TEACHER.toLowerCase()]: HELP_ROLE.TEACHER,
    [HELP_ROLE.PARENT.toLowerCase()]: HELP_ROLE.PARENT,
    [HELP_ROLE.STUDENT.toLowerCase()]: HELP_ROLE.STUDENT,
    [HELP_ROLE.SECRETARY.toLowerCase()]: HELP_ROLE.SECRETARY,
    [HELP_ROLE.ACCOUNTANT.toLowerCase()]: HELP_ROLE.ACCOUNTANT,
    [HELP_ROLE.PREFET_ETUDES.toLowerCase()]: HELP_ROLE.PREFET_ETUDES,
    [HELP_ROLE.PRINCIPAL.toLowerCase()]: HELP_ROLE.PRINCIPAL,
    [HELP_ROLE.PROVISEUR.toLowerCase()]: HELP_ROLE.PROVISEUR,
    [HELP_ROLE.SUPERVISOR.toLowerCase()]: HELP_ROLE.SUPERVISOR,
  }),
);

export function normalizeHelpText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function normalizeHelpRole(role) {
  if (typeof role !== "string" || role.trim() === "") return null;
  const key = normalizeHelpText(role).replace(/['’]/g, " ").replace(/\s+/g, " ");
  return Object.hasOwn(ROLE_ALIASES, key) ? Reflect.get(ROLE_ALIASES, key) : null;
}
