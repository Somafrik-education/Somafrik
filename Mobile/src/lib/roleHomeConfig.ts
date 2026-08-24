/**
 * Accueil par rôle — configuration de coque unique (référence : dashboard Préfet).
 * Aucune permission n’est accordée ici : le runtime filtre KPI et actions
 * (fail-closed — un KPI ou une action disparaît si la route n’est pas lisible).
 */

import { canonicalizeRoleKey, resolveCanonicalRoleIdentity } from "./canonicalRoleIdentity";

export const MAX_HOME_KPIS = 4;

export type RoleHomeKpiKey =
  | "users"
  | "classes"
  | "students"
  | "presence"
  | "payments"
  | "paymentRate"
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
  | "documents"
  | "platformNotifications";

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
  kpiKeys: ["users", "presence", "students", "paymentRate"],
  actionKeys: ["students", "attendance", "payments", "classes", "teachers", "grades", "announcements"],
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

const PROVISEUR: RoleHomeShell = {
  role: "proviseur",
  spaceLabel: "Espace proviseur",
  mission: "Pilotage de l'établissement et suivi pédagogique.",
  accent: "#1D4ED8",
  identityIcon: "analytics-outline",
  bannerIcon: "school-outline",
  kpiKeys: ["classes", "students", "presence", "payments"],
  actionKeys: ["students", "attendance", "grades", "reportCards", "payments", "messages", "announcements"],
  showSecurityMatrix: true,
};

const ADJOINT: RoleHomeShell = {
  role: "adjoint",
  spaceLabel: "Espace adjoint",
  mission: "Appui à la direction et suivi de l'établissement.",
  accent: "#334155",
  identityIcon: "people-outline",
  bannerIcon: "school-outline",
  kpiKeys: ["classes", "students", "presence", "messages"],
  actionKeys: ["students", "attendance", "messages", "announcements"],
  showSecurityMatrix: false,
};

const UNKNOWN: RoleHomeShell = {
  role: "unknown",
  spaceLabel: "Espace établissement",
  mission: "Accès limité aux fonctions autorisées par les permissions live.",
  accent: "#475569",
  identityIcon: "person-outline",
  bannerIcon: "shield-outline",
  kpiKeys: ["messages", "students", "payments", "documents"],
  actionKeys: ["messages", "students", "payments"],
  showSecurityMatrix: false,
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
  actionKeys: ["users", "platformNotifications"],
  showSecurityMatrix: true,
};

const BY_ROLE: Record<string, RoleHomeShell> = {
  school_admin: SCHOOL_ADMIN,
  prefet: PREFET,
  principal: PRINCIPAL,
  proviseur: PROVISEUR,
  adjoint: ADJOINT,
  secretary: SECRETARY,
  accountant: ACCOUNTANT,
  teacher: TEACHER,
  parent_student: PARENT,
  student: STUDENT,
  super_admin: PLATFORM,
  country_admin: PLATFORM,
  unknown: UNKNOWN,
};

const HOME_KEY_BY_ROLE_KEY: Record<string, string> = {
  SUPER_ADMIN: "super_admin",
  COUNTRY_ADMIN: "country_admin",
  SCHOOL_ADMIN: "school_admin",
  PRINCIPAL: "principal",
  PROVISEUR: "proviseur",
  PREFET_ETUDES: "prefet",
  SECRETARY: "secretary",
  ACCOUNTANT: "accountant",
  ADJOINT: "adjoint",
  TEACHER: "teacher",
  PARENT: "parent_student",
  STUDENT: "student",
};

/** Résout la coque Accueil. Ne change pas les droits métier. */
export function resolveRoleHomeKey(session?: any): string {
  const identity = resolveCanonicalRoleIdentity(session);
  const mapped = HOME_KEY_BY_ROLE_KEY[canonicalizeRoleKey(identity.roleKey)];
  if (mapped && BY_ROLE[mapped]) return mapped;
  const sessionRole = String(identity.sessionRole || session?.role || "").trim();
  if (sessionRole && BY_ROLE[sessionRole]) return sessionRole;
  return "unknown";
}

export function getRoleHomeShell(session?: any): RoleHomeShell {
  const key = resolveRoleHomeKey(session);
  return BY_ROLE[key] ?? UNKNOWN;
}

export function selectHomeKpis<T>(items: T[], max = MAX_HOME_KPIS): T[] {
  return items.slice(0, max);
}
