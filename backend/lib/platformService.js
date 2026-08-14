"use strict";

const { randomUUID } = require("node:crypto");
const {
  PLATFORM_ERROR,
  asTrimmed,
  createPlatformError,
  ignoreClientScope,
  isSuperAdminPrincipal,
  isCountryAdminPrincipal,
  assertCountryScope,
  assertSchoolScope,
  assertSuperAdmin,
  resolvePrincipalCountryCode,
  assertSchoolInPrincipalCountry,
  assertNotificationScope,
  assertSubscriptionPaymentScope,
  assertSubscriptionDiscountScope,
  mapCountryRow,
  mapSubscriptionRow,
  mapNotificationRow,
  mapOfferRow,
  mapSubscriptionPaymentRow,
  mapSubscriptionDiscountRow,
  mapSubscriptionAuditRow,
} = require("./platformManagement");

async function writePlatformAudit(tx, principal, auditMeta, entry) {
  if (typeof tx.recordPlatformAudit !== "function") {
    throw createPlatformError(500, "Audit plateforme indisponible dans la transaction.");
  }
  await tx.recordPlatformAudit({
    schoolCode: entry.schoolCode || principal?.schoolCode,
    userId: principal?.sub || principal?.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: String(entry.entityId ?? ""),
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    ipAddress: auditMeta?.ipAddress,
    userAgent: auditMeta?.userAgent,
  });
}

async function appendSubscriptionAudit(tx, entry) {
  await tx.insertSubscriptionAudit(entry);
}

async function createCountry(store, rawPayload, principal, auditMeta) {
  assertSuperAdmin(principal);
  const payload = ignoreClientScope(rawPayload);
  const code = asTrimmed(payload.code).toUpperCase();
  const name = asTrimmed(payload.name);
  if (!code || !name) {
    throw createPlatformError(400, "Nom et code pays obligatoires.");
  }
  if (!/^[A-Z]{2}$/.test(code)) {
    throw createPlatformError(400, "Le code pays doit comporter 2 lettres.");
  }
  return store.withTransaction(async (tx) => {
    const existing = await tx.getCountryByCode(code);
    if (existing) {
      throw createPlatformError(409, "Code pays déjà utilisé.", PLATFORM_ERROR.COUNTRY_DUPLICATE);
    }
    const saved = await tx.insertCountry({
      name,
      isoCode: code,
      phonePrefix: asTrimmed(payload.phonePrefix) || "+000",
      currency: asTrimmed(payload.currency) || "USD",
      isActive: payload.status !== "Suspendu",
      profile: { timezone: payload.timezone, administratorId: payload.administratorId },
    });
    await writePlatformAudit(tx, principal, auditMeta, {
      action: "create_country",
      entityType: "country",
      entityId: code,
      newValue: saved,
    });
    return mapCountryRow(saved);
  });
}

async function updateCountry(store, code, rawPatch, principal, auditMeta) {
  const countryCode = asTrimmed(code).toUpperCase();
  assertCountryScope(principal, countryCode);
  if (!isSuperAdminPrincipal(principal)) {
    throw createPlatformError(403, "Seul le Super Administrateur peut modifier un pays.", PLATFORM_ERROR.FORBIDDEN);
  }
  const patch = ignoreClientScope(rawPatch);
  return store.withTransaction(async (tx) => {
    const existing = await tx.getCountryByCode(countryCode);
    if (!existing) {
      throw createPlatformError(404, "Pays introuvable.", PLATFORM_ERROR.COUNTRY_NOT_FOUND);
    }
    const existingProfile = require("./platformManagement").parsePayload(existing.profile_payload);
    const saved = await tx.updateCountry(countryCode, {
      name: patch.name ?? existing.name,
      phonePrefix: patch.phonePrefix ?? existing.phone_code,
      currency: patch.currency ?? existing.currency,
      isActive: patch.status ? patch.status !== "Suspendu" : existing.is_active,
      profile: {
        timezone: patch.timezone ?? existingProfile.timezone,
        administratorId: patch.administratorId ?? existingProfile.administratorId,
        subscriptionPolicy: patch.subscriptionPolicy ?? existingProfile.subscriptionPolicy,
      },
    });
    await writePlatformAudit(tx, principal, auditMeta, {
      action: "update_country",
      entityType: "country",
      entityId: countryCode,
      oldValue: mapCountryRow(existing),
      newValue: mapCountryRow(saved),
    });
    return mapCountryRow(saved);
  });
}

async function upsertSubscription(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  let schoolCode = asTrimmed(principal?.schoolCode);
  if (isSuperAdminPrincipal(principal) || isCountryAdminPrincipal(principal)) {
    schoolCode = asTrimmed(rawPayload.schoolCode || rawPayload.schoolId || schoolCode);
  }
  schoolCode = schoolCode.toUpperCase();
  if (!schoolCode || schoolCode === "*") {
    throw createPlatformError(400, "Code établissement obligatoire.");
  }
  assertSchoolScope(principal, schoolCode);
  if (isCountryAdminPrincipal(principal)) {
    const school = await store.getSchoolByCode(schoolCode);
    const principalCountry = resolvePrincipalCountryCode(principal);
    if (!school || asTrimmed(school.country_code).toUpperCase() !== principalCountry.toUpperCase()) {
      throw createPlatformError(403, "Accès refusé : établissement hors périmètre pays.", PLATFORM_ERROR.TENANT_MISMATCH);
    }
  }
  return store.withTransaction(async (tx) => {
    const school = await tx.getSchoolByCode(schoolCode);
    if (!school) {
      throw createPlatformError(404, "Établissement introuvable.", PLATFORM_ERROR.SCHOOL_NOT_FOUND);
    }
    const existing = await tx.getSubscriptionBySchoolId(school.id);
    const profile = {
      offerId: payload.offerId,
      plan: payload.plan,
      monthlyPrice: payload.monthlyPrice,
      annualPrice: payload.annualPrice,
      status: payload.status,
      lifecycleStatus: payload.lifecycleStatus,
      paymentStatus: payload.paymentStatus,
      billingCycle: payload.billingCycle,
      paymentMethod: payload.paymentMethod,
      nextRenewalDate: payload.nextRenewalDate,
      lastPaymentDate: payload.lastPaymentDate,
      maxStudents: payload.maxStudents,
      maxTeachers: payload.maxTeachers,
      maxUsers: payload.maxUsers,
      activatedModules: payload.activatedModules,
      trialUsed: payload.trialUsed,
      accessLevel: payload.accessLevel,
      suspensionReason: payload.suspensionReason,
      cancellationRequestedAt: payload.cancellationRequestedAt,
      cancellationEffectiveDate: payload.cancellationEffectiveDate,
      cancellationReason: payload.cancellationReason,
    };
    const saved = existing
      ? await tx.updateSubscription(existing.id, {
          planName: asTrimmed(payload.plan) || existing.plan_name,
          pricePerStudent: Number(payload.monthlyPrice ?? existing.price_per_student ?? 0),
          billingCurrency: asTrimmed(payload.currency) || existing.billing_currency,
          billingCycle: asTrimmed(payload.billingCycle) || existing.billing_cycle,
          status: normalizeSubscriptionStatus(payload.status ?? existing.status),
          startDate: payload.startDate ?? existing.start_date,
          endDate: payload.endDate ?? existing.end_date,
          profile,
        })
      : await tx.insertSubscription({
          schoolId: school.id,
          planName: asTrimmed(payload.plan) || "Standard",
          pricePerStudent: Number(payload.monthlyPrice ?? 0),
          billingCurrency: asTrimmed(payload.currency) || school.currency || "USD",
          billingCycle: asTrimmed(payload.billingCycle) || "monthly",
          status: normalizeSubscriptionStatus(payload.status || "trial"),
          startDate: payload.startDate,
          endDate: payload.endDate,
          profile,
        });
    await writePlatformAudit(tx, principal, auditMeta, {
      schoolCode,
      action: existing ? "update_subscription" : "create_subscription",
      entityType: "subscription",
      entityId: saved.id,
      oldValue: existing ? mapSubscriptionRow({ ...existing, school_code: schoolCode, country_code: school.country_code, country_name: school.country_name }) : null,
      newValue: mapSubscriptionRow({ ...saved, school_code: schoolCode, country_code: school.country_code, country_name: school.country_name }),
    });
    await appendSubscriptionAudit(tx, {
      schoolId: school.id,
      subscriptionId: saved.id,
      action: existing ? "Modification abonnement" : "Création abonnement",
      profile: {
        author: principal?.identifier || principal?.email,
        details: `${schoolCode} — ${payload.plan || saved.plan_name}`,
        schoolCode,
        subscriptionId: saved.id,
      },
    });
    return mapSubscriptionRow({ ...saved, school_code: schoolCode, country_code: school.country_code, country_name: school.country_name });
  });
}

function normalizeSubscriptionStatus(status) {
  const key = asTrimmed(status).toLowerCase();
  if (key === "actif" || key === "active") return "active";
  if (key === "suspendu" || key === "suspended") return "suspended";
  if (key === "expiré" || key === "expire" || key === "expired") return "expired";
  if (key === "trial" || key === "essai") return "trial";
  return key || "trial";
}

async function createNotification(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  const title = asTrimmed(rawPayload.title ?? payload.title);
  const message = asTrimmed(rawPayload.message ?? payload.message);
  if (!title || !message) {
    throw createPlatformError(400, "Titre et message obligatoires.");
  }
  const schoolCode = asTrimmed(principal?.schoolCode);
  if (!isSuperAdminPrincipal(principal) && !isCountryAdminPrincipal(principal)) {
    assertSchoolScope(principal, schoolCode);
  }
  return store.withTransaction(async (tx) => {
    let school = null;
    if (schoolCode && schoolCode !== "*") {
      school = await tx.getSchoolByCode(schoolCode);
      if (!school && !isSuperAdminPrincipal(principal) && !isCountryAdminPrincipal(principal)) {
        throw createPlatformError(404, "Établissement introuvable.", PLATFORM_ERROR.SCHOOL_NOT_FOUND);
      }
    }
    const countryCode = isCountryAdminPrincipal(principal)
      ? resolvePrincipalCountryCode(principal)
      : asTrimmed(rawPayload.countryCode ?? payload.countryCode);
    if (isCountryAdminPrincipal(principal) && countryCode) {
      assertCountryScope(principal, countryCode);
    }
    const saved = await tx.insertNotification({
      schoolId: school?.id ?? null,
      title,
      message,
      type: asTrimmed(rawPayload.type ?? payload.type) || "Information",
      channel: (rawPayload.channels ?? payload.channels)?.[0] || "app",
      status: (rawPayload.status ?? payload.status) === "Lu" ? "read" : "sent",
      profile: {
        audience: rawPayload.audience ?? payload.audience,
        countryCode: countryCode || undefined,
        schoolCode: school?.school_code,
        priority: rawPayload.priority ?? payload.priority,
        channels: rawPayload.channels ?? payload.channels,
        status: (rawPayload.status ?? payload.status) || "Non lu",
        date: rawPayload.date ?? payload.date,
        createdBy: principal?.identifier || principal?.email || "Plateforme",
      },
    });
    await writePlatformAudit(tx, principal, auditMeta, {
      schoolCode: school?.school_code,
      action: "create_notification",
      entityType: "notification",
      entityId: saved.id,
      newValue: mapNotificationRow(saved),
    });
    return mapNotificationRow(saved);
  });
}

async function updateNotification(store, id, rawPatch, principal, auditMeta) {
  const patch = ignoreClientScope(rawPatch);
  return store.withTransaction(async (tx) => {
    const existing = await tx.getNotificationById(id, principal, { lock: true });
    assertNotificationScope(principal, existing);
    const profile = {
      ...require("./platformManagement").parsePayload(existing.profile_payload),
      ...patch,
      status: patch.status ?? require("./platformManagement").parsePayload(existing.profile_payload).status,
    };
    const archived = patch.archived === true;
    const saved = await tx.updateNotification(existing.id, {
      title: patch.title ?? existing.title,
      message: patch.message ?? existing.message,
      type: patch.type ?? existing.type,
      status: patch.status === "Lu" || patch.status === "read" ? "read" : existing.status,
      readAt: patch.status === "Lu" || patch.status === "read" ? new Date() : existing.read_at,
      profile,
      archived,
    });
    const oldValue = mapNotificationRow(existing);
    const newValue = saved ? mapNotificationRow(saved) : { id: existing.id, archived: true };
    await writePlatformAudit(tx, principal, auditMeta, {
      schoolCode: existing.school_code,
      action: archived ? "archive_notification" : "update_notification",
      entityType: "notification",
      entityId: existing.id,
      oldValue,
      newValue,
    });
    return newValue;
  });
}

async function replaceRolePermissions(store, rawMap, principal, auditMeta) {
  assertSuperAdmin(principal);
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
    throw createPlatformError(400, "rolePermissions doit être un objet.");
  }
  return store.withTransaction(async (tx) => {
    const before = await tx.listRolePermissions();
    const saved = await tx.replaceRolePermissions(rawMap);
    await writePlatformAudit(tx, principal, auditMeta, {
      action: "replace_role_permissions",
      entityType: "role_permissions",
      entityId: "map",
      oldValue: before,
      newValue: saved,
    });
    return saved;
  });
}

async function saveDashboardChartConfig(store, rawConfig, principal, auditMeta) {
  assertSuperAdmin(principal);
  const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  return store.withTransaction(async (tx) => {
    const before = await tx.getDashboardChartConfig();
    const saved = await tx.saveDashboardChartConfig({
      platform: config.platform ?? {},
      establishment: config.establishment ?? {},
    });
    await writePlatformAudit(tx, principal, auditMeta, {
      action: "save_dashboard_chart_config",
      entityType: "dashboard_chart_config",
      entityId: "config",
      oldValue: before,
      newValue: saved,
    });
    return saved;
  });
}

async function upsertSubscriptionOffer(store, rawPayload, principal, auditMeta) {
  assertSuperAdmin(principal);
  const payload = ignoreClientScope(rawPayload);
  const name = asTrimmed(payload.name);
  if (!name) throw createPlatformError(400, "Nom d'offre obligatoire.");
  const countryCodes = (payload.countryCodes ?? []).map((c) => asTrimmed(c).toUpperCase()).filter(Boolean);
  if (!countryCodes.length) throw createPlatformError(400, "Au moins un pays requis.");
  for (const code of countryCodes) {
    const country = await store.getCountryByCode(code);
    if (!country) throw createPlatformError(404, `Pays introuvable : ${code}.`, PLATFORM_ERROR.COUNTRY_NOT_FOUND);
  }
  return store.withTransaction(async (tx) => {
    const offerCode = asTrimmed(payload.id) || `OFFER-${randomUUID().slice(0, 8).toUpperCase()}`;
    const existing = await tx.getOfferByCode(offerCode);
    const profile = { ...payload, id: offerCode, name, countryCodes };
    const saved = existing
      ? await tx.updateOffer(offerCode, { countryCodes, active: payload.active !== false, profile })
      : await tx.insertOffer({ offerCode, countryCodes, active: payload.active !== false, profile });
    await writePlatformAudit(tx, principal, auditMeta, {
      action: existing ? "update_subscription_offer" : "create_subscription_offer",
      entityType: "subscription_offer",
      entityId: offerCode,
      newValue: mapOfferRow(saved),
    });
    await appendSubscriptionAudit(tx, {
      action: existing ? "Modification offre" : "Création offre",
      profile: {
        author: principal?.identifier || principal?.email,
        details: `${name} — ${countryCodes.join(", ")}`,
      },
    });
    return mapOfferRow(saved);
  });
}

async function createSubscriptionPayment(store, rawPayload, principal, auditMeta) {
  const schoolCode = asTrimmed(rawPayload.schoolCode || rawPayload.schoolId).toUpperCase();
  if (!schoolCode) {
    throw createPlatformError(400, "Code établissement obligatoire.");
  }
  assertSchoolScope(principal, schoolCode);
  await assertSchoolInPrincipalCountry(store, principal, schoolCode);
  const payload = ignoreClientScope(rawPayload);
  return store.withTransaction(async (tx) => {
    const school = await tx.getSchoolByCode(schoolCode);
    if (!school) throw createPlatformError(404, "Établissement introuvable.", PLATFORM_ERROR.SCHOOL_NOT_FOUND);
    const subscription = await tx.getSubscriptionBySchoolId(school.id);
    if (!subscription) throw createPlatformError(404, "Abonnement introuvable.", PLATFORM_ERROR.SUBSCRIPTION_NOT_FOUND);
    const paymentCode = asTrimmed(payload.reference) || `SUB-PAY-${Date.now()}`;
    const saved = await tx.insertSubscriptionPayment({
      schoolId: school.id,
      subscriptionId: subscription.id,
      paymentCode,
      amount: Number(payload.amount ?? 0),
      currency: asTrimmed(payload.currency) || subscription.billing_currency || "USD",
      paymentStatus: "pending",
      profile: payload,
    });
    await writePlatformAudit(tx, principal, auditMeta, {
      schoolCode,
      action: "create_subscription_payment",
      entityType: "subscription_payment",
      entityId: paymentCode,
      newValue: mapSubscriptionPaymentRow({ ...saved, school_code: schoolCode }),
    });
    return mapSubscriptionPaymentRow({ ...saved, school_code: schoolCode });
  });
}

async function updateSubscriptionPayment(store, id, rawPatch, principal, auditMeta) {
  const patch = ignoreClientScope(rawPatch);
  return store.withTransaction(async (tx) => {
    const existing = await tx.getSubscriptionPaymentByCode(id, principal, { lock: true });
    await assertSubscriptionPaymentScope(store, principal, existing);
    const profile = { ...require("./platformManagement").parsePayload(existing.profile_payload), ...patch };
    const saved = await tx.updateSubscriptionPayment(existing.id, {
      paymentStatus: patch.status === "Validé" ? "validated" : existing.payment_status,
      profile,
    });
    await writePlatformAudit(tx, principal, auditMeta, {
      schoolCode: existing.school_code,
      action: "update_subscription_payment",
      entityType: "subscription_payment",
      entityId: existing.payment_code,
      oldValue: mapSubscriptionPaymentRow(existing),
      newValue: mapSubscriptionPaymentRow(saved),
    });
    return mapSubscriptionPaymentRow(saved);
  });
}

async function createSubscriptionDiscount(store, rawPayload, principal, auditMeta) {
  const schoolCode = asTrimmed(rawPayload.schoolCode || rawPayload.schoolId).toUpperCase();
  if (schoolCode) {
    assertSchoolScope(principal, schoolCode);
    await assertSchoolInPrincipalCountry(store, principal, schoolCode);
  } else if (isCountryAdminPrincipal(principal)) {
    const countryCode = asTrimmed(rawPayload.countryCode);
    if (!countryCode) {
      throw createPlatformError(400, "Code pays obligatoire pour une remise nationale.");
    }
    assertCountryScope(principal, countryCode);
  }
  const payload = ignoreClientScope(rawPayload);
  return store.withTransaction(async (tx) => {
    let school = null;
    if (schoolCode) {
      school = await tx.getSchoolByCode(schoolCode);
      if (!school) throw createPlatformError(404, "Établissement introuvable.", PLATFORM_ERROR.SCHOOL_NOT_FOUND);
    }
    const saved = await tx.insertSubscriptionDiscount({
      schoolId: school?.id ?? null,
      offerId: payload.offerId,
      status: "pending",
      profile: {
        ...payload,
        id: payload.id || randomUUID(),
        schoolCode: schoolCode || undefined,
        countryCode: rawPayload.countryCode || payload.countryCode,
        status: "En attente",
      },
    });
    await writePlatformAudit(tx, principal, auditMeta, {
      schoolCode,
      action: "create_subscription_discount",
      entityType: "subscription_discount",
      entityId: saved.id,
      newValue: mapSubscriptionDiscountRow(saved),
    });
    return mapSubscriptionDiscountRow(saved);
  });
}

async function updateSubscriptionDiscount(store, id, rawPatch, principal, auditMeta) {
  const patch = ignoreClientScope(rawPatch);
  return store.withTransaction(async (tx) => {
    const existing = await tx.getSubscriptionDiscountById(id, principal, { lock: true });
    await assertSubscriptionDiscountScope(store, principal, existing);
    const profile = { ...require("./platformManagement").parsePayload(existing.profile_payload), ...patch };
    const saved = await tx.updateSubscriptionDiscount(existing.id, {
      status: patch.status ? normalizeDiscountStatus(patch.status) : existing.status,
      profile,
    });
    await writePlatformAudit(tx, principal, auditMeta, {
      schoolCode: existing.school_code,
      action: "update_subscription_discount",
      entityType: "subscription_discount",
      entityId: existing.id,
      oldValue: mapSubscriptionDiscountRow(existing),
      newValue: mapSubscriptionDiscountRow(saved),
    });
    return mapSubscriptionDiscountRow(saved);
  });
}

function normalizeDiscountStatus(status) {
  const key = asTrimmed(status).toLowerCase();
  if (key.startsWith("approu")) return "approved";
  if (key.startsWith("refus")) return "rejected";
  return "pending";
}

module.exports = {
  createCountry,
  updateCountry,
  upsertSubscription,
  createNotification,
  updateNotification,
  replaceRolePermissions,
  saveDashboardChartConfig,
  upsertSubscriptionOffer,
  createSubscriptionPayment,
  updateSubscriptionPayment,
  createSubscriptionDiscount,
  updateSubscriptionDiscount,
};
