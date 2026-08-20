import type {
  Announcement,
  CountryProfile,
  SchoolMessage,
  SchoolProfile,
  SubscriptionItem,
  Teacher,
  UserAccount,
} from "../data/catalog";
import type { PlatformNotification } from "./scope";

export type CanonicalTeacher = Teacher & {
  teacherCode: string;
  status?: string;
  schoolCode?: string;
};

export type CanonicalUserAccount = UserAccount & {
  activeRoles?: string[];
  roleKeys?: string[];
};

export type CanonicalAnnouncement = Announcement & {
  audience?: string;
  status?: string;
  createdAt?: string;
  author?: string;
  schoolCode?: string;
  schoolId?: string;
  countryCode?: string;
};

export type CanonicalSchoolMessage = SchoolMessage & {
  createdAt?: string;
  schoolCode?: string;
  schoolId?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean);
}

function optionalText(value: unknown): string | undefined {
  const next = text(value);
  return next || undefined;
}

/** Clés tenant conservées pour le re-filtrage client (scopeSchoolEntityData). */
export function readTenantScopeFields(value: unknown): {
  schoolCode?: string;
  schoolId?: string;
  countryCode?: string;
  countryScope?: string;
} {
  const row = record(value);
  return {
    schoolCode: optionalText(
      row.schoolPublicCode ??
        row.school_public_code ??
        row.schoolLoginCode ??
        row.school_login_code ??
        row.schoolCode ??
        row.school_code,
    ),
    schoolId: optionalText(row.schoolId ?? row.school_id),
    countryCode: optionalText(row.countryCode ?? row.country_code),
    countryScope: optionalText(row.countryScope ?? row.country_scope),
  };
}

export function normalizeTeacher(value: unknown): CanonicalTeacher | null {
  const row = record(value);
  const id = text(row.id);
  if (!id) return null;
  const firstName = text(row.firstName ?? row.first_name);
  const lastName = text(row.lastName ?? row.last_name);
  const name = text(row.name) || [firstName, lastName].filter(Boolean).join(" ");
  const teacherCode = text(row.teacherCode ?? row.teacher_code ?? row.publicId ?? row.public_id);
  const assignmentRows = Array.isArray(row.assignments) ? row.assignments : [];
  const tenant = readTenantScopeFields(row);
  return {
    id,
    publicId: teacherCode,
    teacherCode,
    name,
    firstName,
    lastName,
    userId: text(row.userId ?? row.user_id) || undefined,
    identifier: text(row.identifier) || teacherCode || undefined,
    gender: text(row.gender),
    phone: text(row.phone),
    email: text(row.email),
    mainSubject: text(row.mainSubject ?? row.main_subject ?? row.speciality),
    schoolCode: tenant.schoolCode,
    assignments: assignmentRows as CanonicalTeacher["assignments"],
    assignedClasses: stringList(row.assignedClasses ?? row.assigned_classes),
    courses: stringList(row.courses),
    status: text(row.status) || undefined,
  };
}

export function normalizeUser(value: unknown): CanonicalUserAccount | null {
  const row = record(value);
  const id = text(row.id);
  if (!id) return null;
  const activeRoles = stringList(row.activeRoles ?? row.active_roles ?? row.roleKeys ?? row.role_keys ?? row.roles);
  const secondaryRoles = stringList(row.secondaryRoles ?? row.secondary_roles);
  const tenant = readTenantScopeFields(row);
  return {
    id,
    publicId: text(row.publicId ?? row.public_id ?? row.userCode ?? row.user_code),
    lastName: text(row.lastName ?? row.last_name),
    firstName: text(row.firstName ?? row.first_name),
    gender: text(row.gender),
    phone: text(row.phone),
    email: text(row.email) || undefined,
    role: activeRoles[0] || text(row.role),
    activeRoles,
    roleKeys: activeRoles,
    secondaryRoles: secondaryRoles.length ? secondaryRoles : activeRoles.slice(1),
    scopeLevel: text(row.scopeLevel ?? row.scope_level),
    countryScope: tenant.countryScope || tenant.countryCode,
    schoolCode: tenant.schoolCode ?? "",
    accessChannel: text(row.accessChannel ?? row.access_channel),
    identifier: text(row.identifier ?? row.userCode ?? row.user_code),
    status: text(row.status),
    permissions: stringList(row.permissions),
    photoUrl: text(row.photoUrl ?? row.photo_url) || undefined,
    createdAt: text(row.createdAt ?? row.created_at),
    lastLoginAt: text(row.lastLoginAt ?? row.last_login_at) || undefined,
    createdBy: text(row.createdBy ?? row.created_by),
    history: stringList(row.history),
  };
}

export function normalizeAnnouncement(value: unknown): CanonicalAnnouncement | null {
  const row = record(value);
  const id = text(row.id);
  if (!id) return null;
  const tenant = readTenantScopeFields(row);
  return {
    id,
    title: text(row.title),
    message: text(row.message),
    date: text(row.date ?? row.createdAt ?? row.created_at),
    scope: text(row.scope) || undefined,
    systemBroadcast: row.systemBroadcast === true || row.system_broadcast === true,
    audience: text(row.audience) || undefined,
    status: text(row.status) || undefined,
    createdAt: text(row.createdAt ?? row.created_at) || undefined,
    author: text(row.author ?? row.authorName ?? row.createdBy ?? row.created_by) || undefined,
    schoolCode: tenant.schoolCode,
    schoolId: tenant.schoolId,
    countryCode: tenant.countryCode,
  };
}

export function normalizeMessage(value: unknown): CanonicalSchoolMessage | null {
  const row = record(value);
  const id = text(row.id);
  if (!id) return null;
  const tenant = readTenantScopeFields(row);
  return {
    id,
    parentPhone: text(row.parentPhone ?? row.parent_phone),
    studentId: text(row.studentId ?? row.student_id) || undefined,
    teacherId: text(row.teacherId ?? row.teacher_id) || undefined,
    schoolCode: tenant.schoolCode,
    schoolId: tenant.schoolId,
    theme: text(row.theme),
    direction: text(row.direction),
    message: text(row.message),
    status: text(row.status),
    date: text(row.date ?? row.createdAt ?? row.created_at),
    attachmentUrl: text(row.attachmentUrl ?? row.attachment_url) || undefined,
    priority: text(row.priority) || undefined,
    sentAt: text(row.sentAt ?? row.sent_at) || undefined,
    readAt: text(row.readAt ?? row.read_at) || undefined,
    archivedAt: text(row.archivedAt ?? row.archived_at) || undefined,
    createdAt: text(row.createdAt ?? row.created_at) || undefined,
  };
}

export function normalizeSchool(value: unknown): SchoolProfile | null {
  const row = record(value);
  const internalCode = text(row.code ?? row.schoolCode ?? row.school_code);
  const loginCode = text(row.loginCode ?? row.login_code ?? row.publicId ?? row.public_id);
  const publicCode = loginCode || internalCode;
  if (!publicCode) return null;
  const tenant = readTenantScopeFields(row);
  return {
    id: text(row.id) || publicCode,
    publicId: publicCode,
    code: publicCode,
    name: text(row.name) || publicCode,
    type: text(row.type ?? row.schoolType ?? row.school_type) || "Établissement",
    city: text(row.city),
    country: text(row.country),
    address: text(row.address),
    phone: text(row.phone),
    email: text(row.email),
    website: text(row.website),
    currency: text(row.currency),
    slogan: text(row.slogan),
    status: (text(row.status) || "Actif") as SchoolProfile["status"],
    logoUrl: optionalText(row.logoUrl ?? row.logo_url),
    schoolYear: text(row.schoolYear ?? row.school_year),
    timezone: text(row.timezone) || "Africa/Kinshasa",
    language: text(row.language) || "Français",
    dateFormat: text(row.dateFormat) || "JJ-MM-AAAA",
    primaryColor: text(row.primaryColor) || "#2563EB",
    subscriptionPlan: text(row.subscriptionPlan),
    subscriptionStartDate: text(row.subscriptionStartDate),
    subscriptionEndDate: text(row.subscriptionEndDate),
    maxStudents: Number(row.maxStudents || 0),
    maxTeachers: Number(row.maxTeachers || 0),
    createdAt: text(row.createdAt ?? row.created_at),
    countryCode: tenant.countryCode,
  };
}

export function normalizeCountry(value: unknown): CountryProfile | null {
  const row = record(value);
  const code = text(row.code ?? row.isoCode ?? row.iso_code);
  const name = text(row.name);
  if (!code && !name) return null;
  return {
    id: text(row.id) || code || name,
    name: name || code,
    code: code || name,
    phonePrefix: text(row.phonePrefix ?? row.phone_code ?? row.phoneCode),
    currency: text(row.currency),
    timezone: text(row.timezone) || "UTC",
    status: (text(row.status) || "Actif") as CountryProfile["status"],
    administratorId: optionalText(row.administratorId),
    createdAt: text(row.createdAt ?? row.created_at),
  };
}

export function normalizeSubscription(value: unknown): SubscriptionItem | null {
  const row = record(value);
  const id = text(row.id);
  const tenant = readTenantScopeFields(row);
  const schoolCode = tenant.schoolCode ?? "";
  if (!id && !schoolCode) return null;
  return {
    id: id || schoolCode,
    schoolCode,
    countryCode: tenant.countryCode ?? text(row.countryCode ?? row.country_code),
    country: text(row.country ?? row.country_name),
    plan: text(row.plan ?? row.plan_name),
    monthlyPrice: Number(row.monthlyPrice ?? 0),
    annualPrice: Number(row.annualPrice ?? 0),
    currency: text(row.currency) || "USD",
    status: (text(row.status) || "Actif") as SubscriptionItem["status"],
    paymentStatus: (text(row.paymentStatus) || "À jour") as SubscriptionItem["paymentStatus"],
    startDate: text(row.startDate ?? row.start_date),
    endDate: text(row.endDate ?? row.end_date),
    lastPaymentDate: text(row.lastPaymentDate ?? row.last_payment_date),
  };
}

export function normalizePlatformNotification(value: unknown): PlatformNotification | null {
  const row = record(value);
  const id = text(row.id);
  const title = text(row.title);
  const message = text(row.message);
  if (!id && !title && !message) return null;
  const tenant = readTenantScopeFields(row);
  return {
    id: id || undefined,
    title,
    message,
    type: optionalText(row.type),
    audience: optionalText(row.audience),
    priority: optionalText(row.priority),
    status: optionalText(row.status),
    date: optionalText(row.date ?? row.createdAt ?? row.created_at),
    countryCode: tenant.countryCode,
    schoolCode: tenant.schoolCode,
    createdBy: optionalText(row.createdBy ?? row.created_by),
  };
}
