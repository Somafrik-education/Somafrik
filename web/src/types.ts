// Types métier alignés sur l'API Express/PostgreSQL de Somafrik.

import type { DashboardChartConfig } from "./lib/chartTypes";

export type { DashboardChartConfig };

export interface School {
  id?: string;
  publicId?: string;
  code: string;
  name: string;
  type?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  address?: string;
  phone?: string;
  email?: string;
  currency?: string;
  status?: string;
  validationStatus?: string;
  validationRequestedBy?: string;
  validationRequestedAt?: string;
  validatedBy?: string | null;
  validatedAt?: string | null;
  subscriptionPlan?: string;
  subscriptionStatus?: string;
  subscriptionEndDate?: string;
  maxStudents?: number;
  maxTeachers?: number;
  logoUrl?: string;
  schoolCode?: string;
}

export interface Country {
  id?: string;
  name: string;
  code: string;
  phonePrefix?: string;
  currency?: string;
  timezone?: string;
  status?: string;
  administratorId?: string;
  createdAt?: string;
  /** Barème d'abonnement propre au pays (repli sur le barème global Somafrik). */
  subscriptionPolicy?: CountrySubscriptionPolicy;
}

export type SubscriptionPlanName = "Essentiel" | "Standard" | "Premium";

export interface SubscriptionPlanPricing {
  monthlyPrice: number;
  annualPrice: number;
}

export interface CountrySubscriptionPolicy {
  currency?: string;
  plans: Record<SubscriptionPlanName, SubscriptionPlanPricing>;
}

export interface Subscription {
  id?: string;
  schoolCode: string;
  countryCode?: string;
  country?: string;
  plan?: string;
  monthlyPrice?: number;
  annualPrice?: number;
  currency?: string;
  status?: string;
  paymentStatus?: string;
  startDate?: string;
  endDate?: string;
  lastPaymentDate?: string;
}

export interface PlatformNotification {
  id?: string;
  audience?: string;
  countryCode?: string;
  schoolCode?: string;
  title: string;
  message: string;
  type?: string;
  priority?: string;
  channels?: string[];
  status?: string;
  date?: string;
  createdBy?: string;
}

export interface UserAccount {
  id?: string;
  publicId?: string;
  /** Contact CRM dont ce compte est l'accès applicatif (UTIL-001). */
  contactId?: string;
  firstName?: string;
  lastName?: string;
  gender?: string;
  phone?: string;
  email?: string;
  role: string;
  secondaryRoles?: string[];
  scopeLevel?: string;
  countryScope?: string;
  schoolCode?: string;
  accessChannel?: string;
  identifier?: string;
  status?: string;
  validationStatus?: string;
  validationRequestedBy?: string;
  validationRequestedAt?: string;
  validatedBy?: string | null;
  validatedAt?: string | null;
  permissions?: string[];
  hasTemporaryPassword?: boolean;
  temporaryPassword?: string;
  birthDate?: string;
  password?: string;
  createdAt?: string;
  lastLoginAt?: string;
  createdBy?: string;
}

export interface SessionUser extends UserAccount {
  mustChangePassword?: boolean;
}

export interface SessionScope {
  label: string;
  hint: string;
}

export interface Session {
  user: SessionUser;
  scope: SessionScope;
  accessToken: string;
  refreshToken?: string;
  permissions?: string[];
  menus?: string[];
  schools: School[];
  users: UserAccount[];
  countries?: Country[];
  subscriptions?: Subscription[];
  notifications?: PlatformNotification[];
  rolePermissions?: Record<string, string[]>;
  academicConfigs?: Record<string, unknown>;
  auditLog?: unknown[];
}

/** Personne référencée dans le CRM Somafrik (socle « contact »). */
export interface Contact {
  id?: string;
  publicId?: string;
  lastName: string;
  firstName: string;
  /** Type métier : Directeur, Secrétaire, Enseignant, Parent, Élève, Étudiant, Comptable, Agent pays, Superadmin. */
  contactType: string;
  /** Compte lié = code de l'établissement (ou compte plateforme). */
  schoolCode: string;
  /** Libellé du compte lié, résolu à l'enregistrement pour l'affichage. */
  accountName?: string;
  phone?: string;
  email?: string;
  gender?: string;
  birthDate?: string;
  address?: string;
  /** Actif, Inactif, Archivé, Suspendu. */
  status: string;
  /** « Oui » si un accès utilisateur doit être créé/maintenu (UTIL-001). */
  hasAccess?: string;
  /** Rôle principal de l'accès applicatif. */
  role?: string;
  /** Rôle secondaire optionnel (UTIL-003). */
  secondaryRole?: string;
  /** Compte utilisateur lié généré à partir du contact. */
  userId?: string;
  userIdentifier?: string;
  /** Fiche opérationnelle Élève liée (contact de type Élève/Étudiant). */
  studentId?: string;
  /** Fiche opérationnelle Enseignant liée (contact de type Enseignant). */
  teacherId?: string;
  createdAt?: string;
}

/** Lien entre un contact et une autre entité (REL-001, REL-004). */
export interface Relation {
  id?: string;
  /** « Parent → Élève » ou « Contact → Compte ». */
  relationType: string;
  fromContactId: string;
  fromContactName?: string;
  /** Cible élève (relation parent-enfant). */
  toStudentId?: string;
  toStudentName?: string;
  /** Compte lié (relation contact-compte multiple). */
  accountCode?: string;
  accountName?: string;
  /** Compte de rattachement principal (portée). */
  schoolCode: string;
  status?: string;
  createdAt?: string;
}

export interface BackOfficeState {
  schools: School[];
  users: UserAccount[];
  countries: Country[];
  contacts: Contact[];
  relations: Relation[];
  subscriptions: Subscription[];
  notifications: PlatformNotification[];
  students: unknown[];
  teachers: unknown[];
  classes: unknown[];
  courses: unknown[];
  assignments: unknown[];
  courseSchedules?: unknown[];
  payments: unknown[];
  presences: unknown[];
  notes: unknown[];
  exams: unknown[];
  bulletins: unknown[];
  documents: unknown[];
  announcements: unknown[];
  messages: unknown[];
  paymentStatuses: unknown[];
  rolePermissions: Record<string, string[]>;
  academicConfigs: Record<string, unknown>;
  dashboardChartConfig?: DashboardChartConfig;
  auditLog?: unknown[];
}

export type LoginProfile = "superadmin" | "country" | "school";
