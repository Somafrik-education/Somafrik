import type { Announcement, SchoolMessage, Teacher, UserAccount } from "../data/catalog";

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
    schoolCode: optionalText(row.schoolCode ?? row.school_code),
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
