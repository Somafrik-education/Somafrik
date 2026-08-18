"use strict";

const { getCountryCodeFromScope } = require("./countryScope");
const { randomBytes } = require("node:crypto");

const CLIENTS_ERROR = Object.freeze({
  TENANT_MISMATCH: "TENANT_MISMATCH",
  INVALID_TENANT_SCOPE: "INVALID_TENANT_SCOPE",
  COUNTRY_REQUIRED: "COUNTRY_REQUIRED",
  SCHOOL_REQUIRED: "SCHOOL_REQUIRED",
  SCHOOL_COUNTRY_MISMATCH: "SCHOOL_COUNTRY_MISMATCH",
  USER_TENANT_REASSIGN_FORBIDDEN: "USER_TENANT_REASSIGN_FORBIDDEN",
  ROLE_SCOPE_CONFLICT: "ROLE_SCOPE_CONFLICT",
  CONFLICT: "CONFLICT",
  SCHOOL_NOT_FOUND: "SCHOOL_NOT_FOUND",
  COUNTRY_NOT_FOUND: "COUNTRY_NOT_FOUND",
  CONTACT_NOT_FOUND: "CONTACT_NOT_FOUND",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  RELATION_NOT_FOUND: "RELATION_NOT_FOUND",
  MESSAGE_NOT_FOUND: "MESSAGE_NOT_FOUND",
  ANNOUNCEMENT_NOT_FOUND: "ANNOUNCEMENT_NOT_FOUND",
  STUDENT_NOT_FOUND: "STUDENT_NOT_FOUND",
  DUPLICATE: "DUPLICATE",
  USER_LOGIN_IDENTITY_DUPLICATE: "USER_LOGIN_IDENTITY_DUPLICATE",
  USER_ROLE_GRANT_FAILED: "USER_ROLE_GRANT_FAILED",
  ROLE_NOT_ALLOWED: "ROLE_NOT_ALLOWED",
  FORBIDDEN: "FORBIDDEN",
  PROVISION_CONFLICT: "PROVISION_CONFLICT",
  PARENT_IDENTITY_AMBIGUOUS: "PARENT_IDENTITY_AMBIGUOUS",
  PARENT_CONTACT_AMBIGUOUS: "PARENT_CONTACT_AMBIGUOUS",
  PARENT_IDENTITY_REQUIRED: "PARENT_IDENTITY_REQUIRED",
  PARENT_NAME_REQUIRED: "PARENT_NAME_REQUIRED",
  PARENT_RELATION_TYPE_INVALID: "PARENT_RELATION_TYPE_INVALID",
});

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);

const ROLE_TO_DB = {
  "Super Administrateur Somafrik": "SUPER_ADMIN",
  "Super Administrateur OKAFRIK": "SUPER_ADMIN",
  "Admin Pays": "COUNTRY_ADMIN",
  "Admin School": "SCHOOL_ADMIN",
  Proviseur: "PROVISEUR",
  Directeur: "PRINCIPAL",
  "Préfet des études": "PREFET_ETUDES",
  Enseignant: "TEACHER",
  Secrétaire: "SECRETARY",
  Comptable: "ACCOUNTANT",
  Parent: "PARENT",
  "Élève / Étudiant": "STUDENT",
  Surveillant: "SUPERVISOR",
};

const ROLE_FROM_DB = Object.fromEntries(
  Object.entries(ROLE_TO_DB).map(([label, code]) => [code, label]),
);
ROLE_FROM_DB.SUPER_ADMIN = "Super Administrateur Somafrik";
ROLE_FROM_DB.SUPERVISOR = "Surveillant";

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function createClientsError(status, message, code, details) {
  const error = new Error(message);
  error.statusCode = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function isSuperAdminPrincipal(principal) {
  return SUPER_ADMIN_ROLES.has(asTrimmed(principal?.role));
}

function isCountryAdminPrincipal(principal) {
  return asTrimmed(principal?.role) === "Admin Pays";
}

function resolvePrincipalCountryCode(principal) {
  return asTrimmed(principal?.countryCode || getCountryCodeFromScope(principal?.countryScope)).toUpperCase();
}

function parsePayload(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function formatDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function toIsoDate(value) {
  const raw = asTrimmed(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const match = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function fromDbStatus(status) {
  const normalized = asTrimmed(status).toLowerCase();
  if (normalized === "active" || normalized === "published") return "Actif";
  if (normalized === "inactive") return "Inactif";
  if (normalized === "archived") return "Archivé";
  if (normalized === "suspended") return "Suspendu";
  if (normalized === "pending_validation") return "En attente de validation";
  return status || "Actif";
}

function toDbStatus(status) {
  const normalized = asTrimmed(status).toLowerCase();
  if (["actif", "active", "published"].includes(normalized)) return "active";
  if (["inactif", "inactive"].includes(normalized)) return "inactive";
  if (["archivé", "archive", "archived"].includes(normalized)) return "archived";
  if (["suspendu", "suspended"].includes(normalized)) return "suspended";
  if (normalized === "en attente de validation") return "pending_validation";
  return normalized || "active";
}

function relationEndpointsFromPayload(payload = {}) {
  return {
    contactId: asTrimmed(payload.fromContactId || payload.contactId),
    studentId: asTrimmed(payload.toStudentId || payload.studentId),
  };
}

function ignoreClientScope(payload = {}) {
  const next = { ...payload };
  delete next.schoolId;
  delete next.schoolCode;
  delete next.countryCode;
  delete next.country;
  delete next.userId;
  delete next.createdBy;
  delete next.senderUserId;
  delete next.senderId;
  delete next.author;
  delete next.fromContactId;
  delete next.toStudentId;
  return next;
}

function clientsAuditMetaFromRequest(req) {
  return {
    ipAddress: req?.ip ?? req?.headers?.["x-forwarded-for"] ?? "",
    userAgent: req?.headers?.["user-agent"] ?? "",
  };
}

function assertSchoolScope(principal, schoolCode) {
  const code = asTrimmed(schoolCode).toUpperCase();
  if (!code || code === "*") {
    if (isSuperAdminPrincipal(principal) || isCountryAdminPrincipal(principal)) return;
    throw createClientsError(403, "Établissement requis.", CLIENTS_ERROR.TENANT_MISMATCH);
  }
  const principalSchool = asTrimmed(principal?.schoolCode).toUpperCase();
  if (isSuperAdminPrincipal(principal)) return;
  if (isCountryAdminPrincipal(principal)) return;
  if (principalSchool && principalSchool !== code) {
    throw createClientsError(403, "Accès refusé : établissement hors périmètre.", CLIENTS_ERROR.TENANT_MISMATCH);
  }
}

async function assertSchoolInPrincipalCountry(store, principal, schoolCode) {
  if (!isCountryAdminPrincipal(principal)) return;
  const school = await store.getSchoolByCode(schoolCode);
  const principalCountry = resolvePrincipalCountryCode(principal);
  if (!school || asTrimmed(school.country_code).toUpperCase() !== principalCountry) {
    throw createClientsError(403, "Accès refusé : établissement hors pays.", CLIENTS_ERROR.TENANT_MISMATCH);
  }
}

function requestedCountryCodeFromPayload(rawPayload = {}) {
  return asTrimmed(
    getCountryCodeFromScope(rawPayload.countryCode || rawPayload.countryScope || rawPayload.country),
  ).toUpperCase();
}

function schoolCountryCode(school) {
  return asTrimmed(school?.country_code || school?.countryCode).toUpperCase();
}

function assertRequestedCountryMatchesSchool(school, requestedCountryCode) {
  const requested = asTrimmed(requestedCountryCode).toUpperCase();
  if (!requested) return;
  if (!school) return;
  const actual = schoolCountryCode(school);
  if (actual !== requested) {
    throw createClientsError(
      409,
      "Le pays demandé ne correspond pas à l'établissement.",
      CLIENTS_ERROR.SCHOOL_COUNTRY_MISMATCH,
      {
        countryCode: requested,
        schoolCountry: actual,
        schoolCode: asTrimmed(school.school_code || school.code || school.schoolCode).toUpperCase(),
      },
    );
  }
}

function generateTemporaryPassword() {
  return `Tmp-${randomBytes(4).toString("hex")}-${randomBytes(2).toString("hex")}`;
}

function generateUserCode() {
  return `USR-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function resolveUserIdentifier({ role, phone, email, userCode }) {
  const dbRole = ROLE_TO_DB[role] ?? role;
  if (dbRole === "STUDENT" && userCode) return asTrimmed(userCode);
  if (dbRole === "PARENT" && phone) return asTrimmed(phone);
  if (email) return asTrimmed(email).toLowerCase();
  return asTrimmed(userCode);
}

/**
 * Projection établissement pour un compte : school_code reste l'alias tenant,
 * school_login_code / school_name portent le code public et le nom.
 * Ne jamais lire users.login_code ici (identité personne).
 */
function schoolPublicProjectionFromSchool(school, fallbackSchoolCode = "*") {
  if (!school) {
    return {
      school_code: fallbackSchoolCode,
      school_login_code: "",
      school_name: "",
    };
  }
  return {
    school_code:
      asTrimmed(school.code ?? school.schoolCode ?? school.school_code).toUpperCase() || fallbackSchoolCode,
    school_login_code: asTrimmed(school.loginCode ?? school.login_code).toUpperCase(),
    school_name: asTrimmed(school.name),
  };
}

function mapUserRow(row) {
  const profile = parsePayload(row.profile_payload);
  const role = ROLE_FROM_DB[row.role] ?? row.role;
  const schoolCode = row.school_code ?? (role === "Admin Pays" ? "*" : "");
  const identityCode = row.identity_code ?? profile.identityCode ?? "";
  const loginCode = row.login_code ?? profile.identifier ?? "";
  return {
    id: row.id,
    publicId: identityCode || row.user_code,
    identityCode,
    loginCode,
    userCode: row.user_code,
    legacyUserCode: row.user_code,
    contactId: profile.contactId || row.contact_id || "",
    firstName: row.first_name,
    lastName: row.last_name,
    gender: row.gender ?? profile.gender ?? "",
    birthDate: formatDate(row.birth_date ?? profile.birthDate),
    phone: row.phone ?? "",
    email: row.email ?? "",
    role,
    secondaryRoles: profile.secondaryRoles ?? [],
    scopeLevel: role === "Super Administrateur Somafrik" ? "Global" : role === "Admin Pays" ? "Pays" : "Établissement",
    countryScope: row.country_name ?? profile.countryScope ?? "",
    countryCode: row.country_code ?? profile.countryCode ?? "",
    schoolCode,
    schoolPublicCode: asTrimmed(row.school_login_code ?? row.schoolPublicCode).toUpperCase(),
    schoolName: asTrimmed(row.school_name ?? row.schoolName),
    schoolId: row.school_id,
    accessChannel: profile.accessChannel ?? "Application",
    identifier: loginCode || resolveUserIdentifier({ role, phone: row.phone, email: row.email, userCode: row.user_code }),
    status: fromDbStatus(row.status),
    permissions: [],
    hasTemporaryPassword: Boolean(row.must_change_password),
    mustChangePassword: Boolean(row.must_change_password),
    photoUrl: profile.photoUrl ?? "",
    createdAt: formatDate(row.created_at),
    lastLoginAt: formatDate(row.last_login_at),
    createdBy: profile.createdBy ?? "PostgreSQL",
    history: profile.history ?? [],
    validationStatus: profile.validationStatus ?? "",
    validationRequestedBy: profile.validationRequestedBy ?? "",
    validationRequestedAt: profile.validationRequestedAt ?? "",
    validatedBy: profile.validatedBy ?? "",
    validatedAt: profile.validatedAt ?? "",
  };
}

function mapContactRow(row) {
  const profile = parsePayload(row.profile_payload);
  return {
    id: row.id,
    publicId: row.contact_code || row.id,
    lastName: row.last_name,
    firstName: row.first_name,
    contactType: row.contact_type,
    schoolCode: row.school_code,
    accountName: profile.accountName ?? row.school_name ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    gender: row.gender ?? "",
    birthDate: formatDate(row.birth_date),
    address: row.address ?? profile.address ?? "",
    status: fromDbStatus(row.status),
    hasAccess: row.user_id ? "Oui" : profile.hasAccess ?? "Non",
    role: profile.role ?? "",
    secondaryRole: profile.secondaryRole ?? "",
    userId: row.user_id ?? "",
    createdAt: formatDate(row.created_at),
  };
}

function mapRelationRow(row) {
  const profile = parsePayload(row.profile_payload);
  return {
    id: row.id,
    relationType: row.relation_type === "parent_student" ? "Parent → Élève" : row.relation_type,
    fromContactId: row.contact_id,
    fromContactName: profile.fromContactName ?? row.contact_name ?? "",
    toStudentId: row.student_id,
    toStudentName: profile.toStudentName ?? row.student_name ?? "",
    schoolCode: row.school_code,
    status: fromDbStatus(row.status),
    createdAt: formatDate(row.created_at),
  };
}

function mapMessageRow(row) {
  const profile = parsePayload(row.profile_payload);
  const statusMap = {
    sent: "Envoyé",
    delivered: "Distribué",
    read: "Lu",
    archived: "Archivé",
  };
  return {
    id: row.id,
    conversationId: row.conversation_id,
    parentPhone: profile.parentPhone ?? row.sender_phone ?? "",
    studentId: profile.studentId ?? row.student_id ?? "",
    teacherId: profile.teacherId ?? "",
    theme: row.theme ?? profile.theme ?? row.subject ?? "",
    direction: row.direction ?? profile.direction ?? "",
    message: row.body,
    body: row.body,
    subject: row.subject ?? row.theme ?? "",
    status: statusMap[asTrimmed(row.status).toLowerCase()] ?? row.status ?? "Envoyé",
    date: formatDate(row.sent_at ?? row.created_at),
    sentAt: formatDateTime(row.sent_at),
    readAt: row.read_at ? formatDateTime(row.read_at) : "",
    attachmentUrl: row.attachment_url ?? "",
    priority: row.priority ?? profile.priority ?? "Moyenne",
    schoolCode: row.school_code,
    senderUserId: row.sender_user_id,
    audit: profile.audit ?? [],
  };
}

function mapAnnouncementRow(row) {
  const profile = parsePayload(row.profile_payload);
  return {
    id: row.id,
    schoolId: row.school_id,
    schoolCode: row.school_code,
    title: row.title,
    message: row.message,
    audience: profile.audience ?? row.target_role ?? "Tous",
    targetRole: row.target_role ?? profile.targetRole ?? "",
    targetClassId: row.target_class_id ?? profile.targetClassId ?? "",
    status: fromDbStatus(row.status),
    date: formatDate(row.published_at ?? row.created_at),
    createdBy: profile.createdByName ?? row.author_name ?? "",
    createdAt: formatDate(row.created_at),
  };
}

function mapUserRowToAuthAccount(row) {
  const user = mapUserRow(row);
  const passwordHash = row.password_hash ?? row.passwordHash ?? null;
  const pinHash = row.pin_hash ?? row.pinHash ?? passwordHash;
  return {
    ...user,
    passwordHash,
    pinHash,
    mustChangePassword:
      row.must_change_password != null ? Boolean(row.must_change_password) : user.mustChangePassword,
    hasTemporaryPassword: Boolean(row.must_change_password ?? user.mustChangePassword),
  };
}

module.exports = {
  CLIENTS_ERROR,
  ROLE_TO_DB,
  ROLE_FROM_DB,
  asTrimmed,
  createClientsError,
  isSuperAdminPrincipal,
  isCountryAdminPrincipal,
  resolvePrincipalCountryCode,
  parsePayload,
  formatDate,
  formatDateTime,
  toIsoDate,
  fromDbStatus,
  toDbStatus,
  relationEndpointsFromPayload,
  ignoreClientScope,
  clientsAuditMetaFromRequest,
  assertSchoolScope,
  assertSchoolInPrincipalCountry,
  requestedCountryCodeFromPayload,
  schoolCountryCode,
  assertRequestedCountryMatchesSchool,
  generateTemporaryPassword,
  generateUserCode,
  resolveUserIdentifier,
  schoolPublicProjectionFromSchool,
  mapUserRow,
  mapUserRowToAuthAccount,
  mapContactRow,
  mapRelationRow,
  mapMessageRow,
  mapAnnouncementRow,
};
