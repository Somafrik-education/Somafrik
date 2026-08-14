"use strict";

const { getCountryCodeFromScope } = require("./countryScope");

const PLATFORM_ERROR = Object.freeze({
  TENANT_MISMATCH: "TENANT_MISMATCH",
  COUNTRY_NOT_FOUND: "COUNTRY_NOT_FOUND",
  COUNTRY_DUPLICATE: "COUNTRY_DUPLICATE",
  SCHOOL_NOT_FOUND: "SCHOOL_NOT_FOUND",
  SUBSCRIPTION_NOT_FOUND: "SUBSCRIPTION_NOT_FOUND",
  NOTIFICATION_NOT_FOUND: "NOTIFICATION_NOT_FOUND",
  OFFER_NOT_FOUND: "OFFER_NOT_FOUND",
  PAYMENT_NOT_FOUND: "PAYMENT_NOT_FOUND",
  DISCOUNT_NOT_FOUND: "DISCOUNT_NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
});

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return asTrimmed(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function createPlatformError(status, message, code, details) {
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

function ignoreClientScope(payload = {}) {
  const next = { ...payload };
  delete next.schoolId;
  delete next.schoolCode;
  delete next.countryCode;
  delete next.country;
  delete next.userId;
  delete next.createdBy;
  delete next.triggeredBy;
  delete next.author;
  delete next.validatedBy;
  delete next.approvedBy;
  return next;
}

function platformAuditMetaFromRequest(req) {
  return {
    ipAddress: req?.ip ?? req?.headers?.["x-forwarded-for"] ?? "",
    userAgent: req?.headers?.["user-agent"] ?? "",
  };
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

function formatDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function mapCountryRow(row) {
  const profile = parsePayload(row.profile_payload);
  return {
    id: row.id,
    name: row.name,
    code: row.iso_code,
    phonePrefix: row.phone_code,
    currency: row.currency,
    timezone: profile.timezone || "UTC",
    status: row.is_active ? "Actif" : "Suspendu",
    administratorId: profile.administratorId || "",
    subscriptionPolicy: profile.subscriptionPolicy,
    createdAt: formatDate(row.created_at),
  };
}

function mapSubscriptionRow(row) {
  const profile = parsePayload(row.profile_payload);
  return {
    id: row.id,
    schoolId: row.school_id,
    schoolCode: row.school_code,
    countryCode: row.country_code,
    country: row.country_name,
    offerId: profile.offerId,
    plan: row.plan_name || profile.plan,
    monthlyPrice: Number(row.price_per_student ?? profile.monthlyPrice ?? 0),
    annualPrice: Number(profile.annualPrice ?? row.price_per_student ?? 0) * 10,
    currency: row.billing_currency || profile.currency || "USD",
    status: profile.status || (row.status === "active" ? "Actif" : row.status),
    lifecycleStatus: profile.lifecycleStatus,
    paymentStatus: profile.paymentStatus || (row.status === "active" ? "À jour" : "En retard"),
    billingCycle: row.billing_cycle || profile.billingCycle,
    paymentMethod: profile.paymentMethod,
    startDate: toIsoDate(row.start_date) || profile.startDate,
    endDate: toIsoDate(row.end_date) || profile.endDate,
    nextRenewalDate: profile.nextRenewalDate,
    lastPaymentDate: formatDate(row.updated_at) || profile.lastPaymentDate,
    maxStudents: profile.maxStudents,
    maxTeachers: profile.maxTeachers,
    maxUsers: profile.maxUsers,
    activatedModules: profile.activatedModules,
    trialUsed: profile.trialUsed,
    accessLevel: profile.accessLevel,
    suspensionReason: profile.suspensionReason,
    cancellationRequestedAt: profile.cancellationRequestedAt,
    cancellationEffectiveDate: profile.cancellationEffectiveDate,
    cancellationReason: profile.cancellationReason,
    ...profile,
  };
}

function resolveNotificationCountryCode(row = {}) {
  const profile = parsePayload(row.profile_payload);
  return asTrimmed(profile.countryCode || row.country_code);
}

function mapNotificationRow(row) {
  if (!row) {
    return null;
  }
  const profile = parsePayload(row.profile_payload);
  const countryCode = resolveNotificationCountryCode(row);
  const { countryCode: _ignoredCountry, ...profileRest } = profile;
  return {
    id: row.id,
    schoolId: row.school_id,
    schoolCode: row.school_code || profile.schoolCode,
    audience: profile.audience || "BackOffice",
    countryCode,
    title: row.title,
    message: row.message,
    type: row.type || profile.type || "Information",
    priority: profile.priority || "Normale",
    channels: profile.channels || [row.channel || "app"],
    status: row.read_at || row.status === "read" || profile.status === "Lu" ? "Lu" : profile.status || "Non lu",
    date: formatDate(row.sent_at ?? row.created_at) || profile.date,
    createdBy: profile.createdBy || "PostgreSQL",
    ...profileRest,
  };
}

function mapOfferRow(row) {
  const profile = parsePayload(row.profile_payload);
  return {
    id: row.offer_code || row.id,
    dbId: row.id,
    countryCodes: row.country_codes ?? profile.countryCodes ?? [],
    active: row.active,
    createdAt: profile.createdAt || formatDate(row.created_at),
    updatedAt: profile.updatedAt || formatDate(row.updated_at),
    ...profile,
    name: profile.name || row.offer_code,
  };
}

function mapSubscriptionPaymentRow(row) {
  const profile = parsePayload(row.profile_payload);
  return {
    id: row.payment_code || row.id,
    dbId: row.id,
    subscriptionId: row.subscription_id || profile.subscriptionId,
    schoolCode: row.school_code,
    amount: Number(row.amount ?? 0),
    currency: row.currency,
    method: profile.method || "",
    reference: row.payment_code || profile.reference,
    status: profile.status || (row.payment_status === "validated" ? "Validé" : "En attente"),
    validatedBy: profile.validatedBy,
    validatedAt: profile.validatedAt,
    receiptId: profile.receiptId,
    periodStart: profile.periodStart,
    periodEnd: profile.periodEnd,
    notes: profile.notes,
    createdAt: profile.createdAt || formatDate(row.created_at),
    ...profile,
  };
}

function mapSubscriptionInvoiceRow(row) {
  const profile = parsePayload(row.profile_payload);
  return {
    id: row.invoice_code || row.id,
    dbId: row.id,
    schoolCode: row.school_code,
    subscriptionId: row.subscription_id || profile.subscriptionId,
    amount: Number(row.amount ?? 0),
    currency: row.currency,
    periodStart: profile.periodStart || "",
    periodEnd: profile.periodEnd || "",
    status: profile.status || row.status,
    issuedAt: profile.issuedAt || formatDate(row.issued_at),
    dueDate: toIsoDate(row.due_date) || profile.dueDate,
    paidAt: profile.paidAt || formatDate(row.paid_at),
    paymentId: profile.paymentId,
    ...profile,
  };
}

function mapSubscriptionDiscountRow(row) {
  const profile = parsePayload(row.profile_payload);
  return {
    id: profile.id || row.id,
    dbId: row.id,
    schoolCode: row.school_code || profile.schoolCode,
    offerId: profile.offerId,
    amount: profile.amount,
    percent: profile.percent,
    reason: profile.reason || "",
    requestedBy: profile.requestedBy,
    approvedBy: profile.approvedBy,
    status: profile.status || row.status,
    createdAt: profile.createdAt || formatDate(row.created_at),
    ...profile,
  };
}

function mapSubscriptionAuditRow(row) {
  const profile = parsePayload(row.profile_payload);
  return {
    id: row.id,
    action: row.action,
    schoolCode: row.school_code || profile.schoolCode,
    subscriptionId: row.subscription_id || profile.subscriptionId,
    author: profile.author,
    details: profile.details,
    createdAt: profile.createdAt || formatDate(row.created_at),
    ...profile,
  };
}

function mapRolePermissionsRows(rows) {
  const map = {};
  for (const row of rows) {
    map[row.role_name] = Array.isArray(row.permissions) ? row.permissions : parsePayload(row.permissions);
  }
  return map;
}

function mapDashboardChartConfigRows(rows) {
  const config = { platform: {}, establishment: {} };
  for (const row of rows) {
    const overrides = parsePayload(row.chart_overrides);
    if (row.scope_key === "platform") {
      config.platform = overrides;
    } else if (row.scope_key === "establishment") {
      config.establishment = overrides;
    }
  }
  return config;
}

function resolvePrincipalCountryCode(principal) {
  return asTrimmed(principal?.countryCode) || getCountryCodeFromScope(principal?.countryScope);
}

function assertCountryScope(principal, countryCode) {
  if (isSuperAdminPrincipal(principal)) return;
  if (isCountryAdminPrincipal(principal)) {
    if (asTrimmed(countryCode).toUpperCase() !== resolvePrincipalCountryCode(principal).toUpperCase()) {
      throw createPlatformError(403, "Accès refusé : pays hors périmètre.", PLATFORM_ERROR.TENANT_MISMATCH);
    }
    return;
  }
  throw createPlatformError(403, "Accès refusé.", PLATFORM_ERROR.FORBIDDEN);
}

function assertSchoolScope(principal, schoolCode) {
  if (isSuperAdminPrincipal(principal) || isCountryAdminPrincipal(principal)) return;
  const scope = asTrimmed(principal?.schoolCode);
  if (!scope || scope === "*") {
    throw createPlatformError(400, "Établissement requis.", PLATFORM_ERROR.TENANT_MISMATCH);
  }
  if (asTrimmed(schoolCode).toUpperCase() !== scope.toUpperCase()) {
    throw createPlatformError(403, "Accès refusé : établissement hors périmètre.", PLATFORM_ERROR.TENANT_MISMATCH);
  }
}

async function assertSchoolInPrincipalCountry(store, principal, schoolCode) {
  if (!isCountryAdminPrincipal(principal)) {
    return;
  }
  const normalized = asTrimmed(schoolCode).toUpperCase();
  if (!normalized) {
    throw createPlatformError(400, "Code établissement obligatoire.");
  }
  const school = await store.getSchoolByCode(normalized);
  if (!school) {
    throw createPlatformError(404, "Établissement introuvable.", PLATFORM_ERROR.SCHOOL_NOT_FOUND);
  }
  const principalCountry = resolvePrincipalCountryCode(principal);
  if (asTrimmed(school.country_code).toUpperCase() !== principalCountry.toUpperCase()) {
    throw createPlatformError(403, "Accès refusé : établissement hors périmètre pays.", PLATFORM_ERROR.TENANT_MISMATCH);
  }
}

function assertNotificationScope(principal, existing) {
  if (!existing) {
    throw createPlatformError(404, "Notification introuvable.", PLATFORM_ERROR.NOTIFICATION_NOT_FOUND);
  }
  if (isSuperAdminPrincipal(principal)) {
    return;
  }

  const profile = parsePayload(existing.profile_payload);
  const schoolCode = asTrimmed(existing.school_code || profile.schoolCode);
  const notificationCountry = resolveNotificationCountryCode(existing);

  if (isCountryAdminPrincipal(principal)) {
    if (!notificationCountry) {
      throw createPlatformError(403, "Accès refusé : notification hors périmètre pays.", PLATFORM_ERROR.TENANT_MISMATCH);
    }
    assertCountryScope(principal, notificationCountry);
    return;
  }

  if (!schoolCode) {
    throw createPlatformError(403, "Accès refusé : notification plateforme hors périmètre.", PLATFORM_ERROR.FORBIDDEN);
  }
  assertSchoolScope(principal, schoolCode);
}

async function assertSubscriptionPaymentScope(store, principal, existing) {
  if (!existing) {
    throw createPlatformError(404, "Paiement introuvable.", PLATFORM_ERROR.PAYMENT_NOT_FOUND);
  }
  if (isSuperAdminPrincipal(principal)) {
    return;
  }
  if (isCountryAdminPrincipal(principal)) {
    await assertSchoolInPrincipalCountry(store, principal, existing.school_code);
    return;
  }
  assertSchoolScope(principal, existing.school_code);
}

async function assertSubscriptionDiscountScope(store, principal, existing) {
  if (!existing) {
    throw createPlatformError(404, "Remise introuvable.", PLATFORM_ERROR.DISCOUNT_NOT_FOUND);
  }
  if (isSuperAdminPrincipal(principal)) {
    return;
  }

  const profile = parsePayload(existing.profile_payload);
  const schoolCode = asTrimmed(existing.school_code || profile.schoolCode);
  if (isCountryAdminPrincipal(principal)) {
    if (!schoolCode) {
      const discountCountry = asTrimmed(profile.countryCode);
      if (!discountCountry) {
        throw createPlatformError(403, "Accès refusé : remise hors périmètre pays.", PLATFORM_ERROR.TENANT_MISMATCH);
      }
      assertCountryScope(principal, discountCountry);
      return;
    }
    await assertSchoolInPrincipalCountry(store, principal, schoolCode);
    return;
  }

  if (!schoolCode) {
    throw createPlatformError(403, "Accès refusé : remise plateforme hors périmètre.", PLATFORM_ERROR.FORBIDDEN);
  }
  assertSchoolScope(principal, schoolCode);
}

function assertSuperAdmin(principal) {
  if (!isSuperAdminPrincipal(principal)) {
    throw createPlatformError(403, "Réservé au Super Administrateur.", PLATFORM_ERROR.FORBIDDEN);
  }
}

module.exports = {
  PLATFORM_ERROR,
  SUPER_ADMIN_ROLES,
  asTrimmed,
  normalizeKey,
  createPlatformError,
  isSuperAdminPrincipal,
  isCountryAdminPrincipal,
  ignoreClientScope,
  platformAuditMetaFromRequest,
  parsePayload,
  toIsoDate,
  formatDate,
  mapCountryRow,
  mapSubscriptionRow,
  mapNotificationRow,
  mapOfferRow,
  mapSubscriptionPaymentRow,
  mapSubscriptionInvoiceRow,
  mapSubscriptionDiscountRow,
  mapSubscriptionAuditRow,
  mapRolePermissionsRows,
  mapDashboardChartConfigRows,
  resolvePrincipalCountryCode,
  resolveNotificationCountryCode,
  assertCountryScope,
  assertSchoolScope,
  assertSchoolInPrincipalCountry,
  assertNotificationScope,
  assertSubscriptionPaymentScope,
  assertSubscriptionDiscountScope,
  assertSuperAdmin,
};
