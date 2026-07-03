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

export interface BackOfficeState {
  schools: School[];
  users: UserAccount[];
  countries: Country[];
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
}

export type LoginProfile = "superadmin" | "country" | "school";
