/**
 * Accueil par rôle — configuration de coque unique (référence : dashboard Préfet).
 * Aucune permission n’est accordée ici : le runtime filtre KPI et actions.
 */

export const MAX_HOME_KPIS = 4;

export type RoleHomeKpiKey =
  | "users"
  | "classes"
  | "students"
  | "presence"
  | "payments"
  | "teachers"
  | "courses"
  | "notes"
  | "average"
  | "pendingPayments"
  | "paidPayments"
  | "unpaidPayments"
  | "paymentCount"
  | "documents"
  | "messages"
  | "announcements"
  | "countries"
  | "schools";

export type RoleHomeActionKey =
  | "users"
  | "classes"
  | "teachers"
  | "payments"
  | "announcements"
  | "students"
  | "attendance"
  | "grades"
  | "reportCards"
  | "messages"
  | "timetable"
  | "profile"
  | "notes"
  | "presences"
  | "studentPayments"
  | "documents";

export type RoleHomeShell = {
  role: string;
  spaceLabel: string;
  mission: string;
  accent: string;
  identityIcon: string;
  bannerIcon: string;
  kpiKeys: RoleHomeKpiKey[];
  actionKeys: RoleHomeActionKey[];
  showSecurityMatrix: boolean;
};

const SCHOOL_ADMIN: RoleHomeShell = {
  role: "school_admin",
  spaceLabel: "Espace administrateur",
  mission: "Gestion de l'établissement, utilisateurs, finances et organisation scolaire.",
  accent: "#1D4ED8",
  identityIcon: "briefcase-outline",
  bannerIcon: "business-outline",
  kpiKeys: ["users", "classes", "students", "payments"],
  actionKeys: ["users", "classes", "teachers", "payments", "announcements"],
  showSecurityMatrix: true,
};

const PREFET: RoleHomeShell = {
  role: "prefet",
  spaceLabel: "Espace préfet des études",
  mission: "Pilotage pédagogique, présences, notes, bulletins et rapports.",
  accent: "#1D4ED8",
  identityIcon: "analytics-outline",
  bannerIcon: "school-outline",
  kpiKeys: ["classes", "students", "presence", "payments"],
  actionKeys: ["students", "attendance", "grades", "reportCards", "payments", "messages", "announcements"],
  showSecurityMatrix: true,
};

const PRINCIPAL: RoleHomeShell = {
  role: "principal",
  spaceLabel: "Espace directeur",
  mission: "Pilotage global de l'établissement.",
  accent: "#1D4ED8",
  identityIcon: "analytics-outline",
  bannerIcon: "school-outline",
  kpiKeys: ["students", "users", "presence", "payments"],
  actionKeys: ["students", "attendance", "grades", "reportCards", "payments", "messages", "announcements"],
  showSecurityMatrix: true,
};

const SECRETARY: RoleHomeShell = {
  role: "secretary",
  spaceLabel: "Espace secrétariat",
  mission: "Administration scolaire et dossiers.",
  accent: "#0F766E",
  identityIcon: "briefcase-outline",
  bannerIcon: "people-outline",
  kpiKeys: ["students", "classes", "documents", "messages"],
  actionKeys: ["students", "attendance", "payments", "documents", "messages", "announcements"],
  showSecurityMatrix: true,
};

const ACCOUNTANT: RoleHomeShell = {
  role: "accountant",
  spaceLabel: "Espace comptable",
  mission: "Frais scolaires, encaissements et suivi financier.",
  accent: "#C2410C",
  identityIcon: "card-outline",
  bannerIcon: "wallet-outline",
  kpiKeys: ["pendingPayments", "paidPayments", "unpaidPayments", "paymentCount"],
  actionKeys: ["payments", "students", "messages"],
  showSecurityMatrix: true,
};

const TEACHER: RoleHomeShell = {
  role: "teacher",
  spaceLabel: "Espace enseignant",
  mission: "Enseignement, évaluations et suivi des élèves.",
  accent: "#4338CA",
  identityIcon: "school-outline",
  bannerIcon: "reader-outline",
  kpiKeys: ["classes", "students", "presence", "courses"],
  actionKeys: ["classes", "students", "attendance", "grades", "timetable", "reportCards", "messages"],
  showSecurityMatrix: false,
};

const PARENT: RoleHomeShell = {
  role: "parent_student",
  spaceLabel: "Espace parent",
  mission: "Suivi scolaire de l'enfant.",
  accent: "#0F766E",
  identityIcon: "person-circle-outline",
  bannerIcon: "book-outline",
  kpiKeys: ["presence", "average", "payments", "messages"],
  actionKeys: ["profile", "notes", "presences", "studentPayments", "messages"],
  showSecurityMatrix: false,
};

const STUDENT: RoleHomeShell = {
  role: "student",
  spaceLabel: "Espace élève",
  mission: "Vie scolaire et résultats.",
  accent: "#0F766E",
  identityIcon: "person-circle-outline",
  bannerIcon: "book-outline",
  kpiKeys: ["courses", "presence", "notes", "announcements"],
  actionKeys: ["profile", "notes", "presences", "studentPayments", "timetable"],
  showSecurityMatrix: false,
};

const PLATFORM: RoleHomeShell = {
  role: "platform",
  spaceLabel: "Espace plateforme",
  mission: "Pilotage des établissements, abonnements et comptes.",
  accent: "#1D4ED8",
  identityIcon: "globe-outline",
  bannerIcon: "grid-outline",
  kpiKeys: ["countries", "schools", "users", "payments"],
  actionKeys: ["users", "classes", "teachers", "payments"],
  showSecurityMatrix: true,
};

const BY_ROLE: Record<string, RoleHomeShell> = {
  school_admin: SCHOOL_ADMIN,
  prefet: PREFET,
  principal: PRINCIPAL,
  secretary: SECRETARY,
  accountant: ACCOUNTANT,
  teacher: TEACHER,
  parent_student: PARENT,
  student: STUDENT,
  super_admin: PLATFORM,
  country_admin: PLATFORM,
};

function normalizeRoleKey(value?: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/** Résout la coque Accueil. Ne change pas les droits métier. */
export function resolveRoleHomeKey(session?: any): string {
  const sessionRole = normalizeRoleKey(session?.role);
  const platformRole = normalizeRoleKey(session?.user?.role);
  if (sessionRole === "accountant" || platformRole.includes("comptable")) return "accountant";
  if (sessionRole && BY_ROLE[sessionRole]) return sessionRole;
  if (platformRole.includes("prefet")) return "prefet";
  if (platformRole.includes("directeur") || platformRole.includes("proviseur")) return "principal";
  if (platformRole.includes("secretaire")) return "secretary";
  if (platformRole.includes("enseignant")) return "teacher";
  return sessionRole || "school_admin";
}

export function getRoleHomeShell(session?: any): RoleHomeShell {
  const key = resolveRoleHomeKey(session);
  return BY_ROLE[key] ?? SCHOOL_ADMIN;
}

export function selectHomeKpis<T>(items: T[], max = MAX_HOME_KPIS): T[] {
  return items.slice(0, max);
}
