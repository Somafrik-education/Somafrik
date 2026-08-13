"use strict";

const { randomUUID } = require("node:crypto");
const platformService = require("../lib/platformService");
const {
  asTrimmed,
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
  parsePayload,
} = require("../lib/platformManagement");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolveSeedSchoolId(schoolCode, seed = {}) {
  const normalized = asTrimmed(schoolCode).toUpperCase();
  if (!normalized) return null;
  if (seed.school && asTrimmed(seed.school.code).toUpperCase() === normalized) {
    return seed.school.id;
  }
  const match = (seed.platformSchools ?? []).find(
    (row) => asTrimmed(row.code ?? row.schoolCode).toUpperCase() === normalized,
  );
  return match?.id ?? `school-${normalized}`;
}

function bootstrapPlatformMemoryFromSeed(tables, seed = {}) {
  if (tables.countries.length) {
    return;
  }

  for (const country of seed.countries ?? []) {
    tables.countries.push({
      id: country.id ?? randomUUID(),
      name: country.name,
      iso_code: country.code,
      phone_code: country.phonePrefix ?? country.phone_code ?? "",
      currency: country.currency ?? "USD",
      is_active: asTrimmed(country.status).toLowerCase() !== "suspendu",
      profile_payload: {},
      created_at: new Date(),
    });
  }

  tables.rolePermissions = clone(seed.rolePermissions ?? {});
  tables.chartConfig = clone(seed.dashboardChartConfig ?? { platform: {}, establishment: {} });

  for (const offer of seed.subscriptionOffers ?? []) {
    tables.offers.push({
      id: offer.id ?? randomUUID(),
      offer_code: offer.id ?? offer.offerCode ?? randomUUID(),
      country_codes: offer.countryCodes ?? [],
      active: offer.active !== false,
      profile_payload: offer,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  for (const subscription of seed.subscriptions ?? []) {
    const schoolCode = subscription.schoolCode ?? subscription.school_code;
    const schoolId = resolveSeedSchoolId(schoolCode, seed);
    tables.subscriptions.push({
      id: subscription.id ?? randomUUID(),
      school_id: schoolId,
      school_code: schoolCode,
      country_code: subscription.countryCode ?? subscription.country_code,
      country_name: subscription.country ?? subscription.country_name,
      plan_name: subscription.plan ?? subscription.planName,
      price_per_student: Number(subscription.monthlyPrice ?? subscription.pricePerStudent ?? 0),
      billing_currency: subscription.currency ?? "USD",
      billing_cycle: subscription.billingCycle ?? "monthly",
      status: asTrimmed(subscription.status).toLowerCase() === "actif" ? "active" : "suspended",
      start_date: subscription.startDate ?? null,
      end_date: subscription.endDate ?? null,
      profile_payload: subscription,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  for (const notification of seed.platformNotifications ?? []) {
    tables.notifications.push({
      id: notification.id ?? randomUUID(),
      school_id: notification.schoolId ?? resolveSeedSchoolId(notification.schoolCode, seed),
      school_code: notification.schoolCode,
      title: notification.title,
      message: notification.message ?? notification.body ?? "",
      type: notification.type ?? "Information",
      channel: Array.isArray(notification.channels) ? notification.channels[0] : "app",
      status: notification.status ?? "Non lu",
      profile_payload: notification,
      created_at: new Date(),
    });
  }
}

function createPlatformMemoryStore({ getSchoolByCode, getCountryByCode, seed } = {}) {
  const tables = {
    countries: [],
    subscriptions: [],
    notifications: [],
    offers: [],
    payments: [],
    invoices: [],
    discounts: [],
    auditLog: [],
    rolePermissions: {},
    chartConfig: { platform: {}, establishment: {} },
    auditLogs: [],
  };

  if (seed) {
    bootstrapPlatformMemoryFromSeed(tables, seed);
  }

  function txApi() {
    return {
      async getSchoolByCode(code) {
        const school = await getSchoolByCode?.(code);
        if (!school) return null;
        const { getCountryCodeFromScope } = require("../lib/countryScope");
        const countryCode =
          school.country_code ??
          school.countryCode ??
          getCountryCodeFromScope(school.country) ??
          String(school.school_code ?? school.code ?? school.schoolCode ?? "").slice(0, 2).toUpperCase();
        return {
          id: school.id || school.school_code || school.code || school.schoolCode || randomUUID(),
          school_code: school.school_code ?? school.code ?? school.schoolCode,
          country_code: countryCode,
          country_name: school.country_name ?? school.country,
          currency: school.currency || "USD",
        };
      },
      async getCountryByCode(code) {
        const row = tables.countries.find((c) => asTrimmed(c.iso_code).toUpperCase() === asTrimmed(code).toUpperCase());
        return row ?? null;
      },
      async insertCountry(row) {
        const saved = {
          id: randomUUID(),
          name: row.name,
          iso_code: row.isoCode,
          phone_code: row.phonePrefix,
          currency: row.currency,
          is_active: row.isActive,
          profile_payload: row.profile ?? {},
          created_at: new Date(),
        };
        tables.countries.push(saved);
        return saved;
      },
      async updateCountry(code, row) {
        const existing = await this.getCountryByCode(code);
        Object.assign(existing, {
          name: row.name,
          phone_code: row.phonePrefix,
          currency: row.currency,
          is_active: row.isActive,
          profile_payload: { ...parsePayload(existing.profile_payload), ...(row.profile ?? {}) },
        });
        return existing;
      },
      async getSubscriptionBySchoolId(schoolId) {
        return tables.subscriptions.find((s) => s.school_id === schoolId) ?? null;
      },
      async insertSubscription(row) {
        const saved = {
          id: randomUUID(),
          school_id: row.schoolId,
          plan_name: row.planName,
          price_per_student: row.pricePerStudent,
          billing_currency: row.billingCurrency,
          billing_cycle: row.billingCycle,
          status: row.status,
          start_date: row.startDate,
          end_date: row.endDate,
          profile_payload: row.profile ?? {},
          created_at: new Date(),
          updated_at: new Date(),
        };
        tables.subscriptions.push(saved);
        return saved;
      },
      async updateSubscription(id, row) {
        const existing = tables.subscriptions.find((s) => s.id === id);
        Object.assign(existing, {
          plan_name: row.planName,
          price_per_student: row.pricePerStudent,
          billing_currency: row.billingCurrency,
          billing_cycle: row.billingCycle,
          status: row.status,
          start_date: row.startDate,
          end_date: row.endDate,
          profile_payload: { ...parsePayload(existing.profile_payload), ...(row.profile ?? {}) },
          updated_at: new Date(),
        });
        return existing;
      },
      async getNotificationById(id) {
        return tables.notifications.find((n) => n.id === id || parsePayload(n.profile_payload).publicId === id) ?? null;
      },
      async insertNotification(row) {
        const saved = {
          id: randomUUID(),
          school_id: row.schoolId,
          title: row.title,
          message: row.message,
          type: row.type,
          channel: row.channel,
          status: row.status,
          profile_payload: row.profile ?? {},
          school_code: row.profile?.schoolCode,
          created_at: new Date(),
        };
        tables.notifications.unshift(saved);
        return saved;
      },
      async updateNotification(id, row) {
        if (row.archived) {
          const index = tables.notifications.findIndex((n) => n.id === id);
          if (index >= 0) tables.notifications.splice(index, 1);
          return null;
        }
        const existing = tables.notifications.find((n) => n.id === id);
        Object.assign(existing, {
          title: row.title,
          message: row.message,
          type: row.type,
          status: row.status,
          read_at: row.readAt,
          profile_payload: { ...parsePayload(existing.profile_payload), ...(row.profile ?? {}) },
        });
        return existing;
      },
      async listRolePermissions() {
        return clone(tables.rolePermissions);
      },
      async replaceRolePermissions(map) {
        tables.rolePermissions = clone(map);
        return tables.rolePermissions;
      },
      async getDashboardChartConfig() {
        return clone(tables.chartConfig);
      },
      async saveDashboardChartConfig(config) {
        tables.chartConfig = clone(config);
        return tables.chartConfig;
      },
      async getOfferByCode(code) {
        return tables.offers.find((o) => o.offer_code === code) ?? null;
      },
      async insertOffer(row) {
        const saved = {
          id: randomUUID(),
          offer_code: row.offerCode,
          country_codes: row.countryCodes,
          active: row.active,
          profile_payload: row.profile ?? {},
          created_at: new Date(),
          updated_at: new Date(),
        };
        tables.offers.push(saved);
        return saved;
      },
      async updateOffer(offerCode, row) {
        const existing = tables.offers.find((o) => o.offer_code === offerCode);
        Object.assign(existing, {
          country_codes: row.countryCodes,
          active: row.active,
          profile_payload: { ...parsePayload(existing.profile_payload), ...(row.profile ?? {}) },
          updated_at: new Date(),
        });
        return existing;
      },
      async getSubscriptionPaymentByCode(code) {
        return tables.payments.find((p) => p.payment_code === code || p.id === code) ?? null;
      },
      async insertSubscriptionPayment(row) {
        const saved = {
          id: randomUUID(),
          school_id: row.schoolId,
          subscription_id: row.subscriptionId,
          payment_code: row.paymentCode,
          amount: row.amount,
          currency: row.currency,
          payment_status: row.paymentStatus,
          profile_payload: row.profile ?? {},
          created_at: new Date(),
        };
        tables.payments.push(saved);
        return saved;
      },
      async updateSubscriptionPayment(id, row) {
        const existing = tables.payments.find((p) => p.id === id);
        Object.assign(existing, {
          payment_status: row.paymentStatus,
          profile_payload: { ...parsePayload(existing.profile_payload), ...(row.profile ?? {}) },
        });
        return existing;
      },
      async getSubscriptionDiscountById(id) {
        return tables.discounts.find((d) => d.id === id || parsePayload(d.profile_payload).id === id) ?? null;
      },
      async insertSubscriptionDiscount(row) {
        const saved = {
          id: randomUUID(),
          school_id: row.schoolId,
          offer_id: row.offerId,
          status: row.status,
          profile_payload: row.profile ?? {},
          created_at: new Date(),
        };
        tables.discounts.push(saved);
        return saved;
      },
      async updateSubscriptionDiscount(id, row) {
        const existing = tables.discounts.find((d) => d.id === id);
        Object.assign(existing, {
          status: row.status,
          profile_payload: { ...parsePayload(existing.profile_payload), ...(row.profile ?? {}) },
        });
        return existing;
      },
      async insertSubscriptionAudit(entry) {
        tables.auditLog.unshift({
          id: randomUUID(),
          school_id: entry.schoolId,
          subscription_id: entry.subscriptionId,
          action: entry.action,
          profile_payload: entry.profile ?? {},
          created_at: new Date(),
        });
      },
      async resolveActorUserId() {
        return null;
      },
      async recordPlatformAudit(entry) {
        tables.auditLogs.push(entry);
      },
    };
  }

  let tx = null;
  const api = {
    withTransaction(fn) {
      tx = txApi();
      return fn(tx).finally(() => {
        tx = null;
      });
    },
    getSchoolByCode: (code) => txApi().getSchoolByCode(code),
    getCountryByCode: (code) => txApi().getCountryByCode(code),
    async listProjection() {
      const schools = new Map();
      for (const fn of [getSchoolByCode]) {
        void fn;
      }
      return {
        countries: tables.countries.map(mapCountryRow),
        subscriptions: tables.subscriptions.map((row) =>
          mapSubscriptionRow({
            ...row,
            school_code: row.school_code,
            country_code: row.country_code,
            country_name: row.country_name,
          }),
        ),
        notifications: tables.notifications.map(mapNotificationRow),
        subscriptionOffers: tables.offers.map(mapOfferRow),
        subscriptionPayments: tables.payments.map((row) => mapSubscriptionPaymentRow({ ...row, school_code: row.school_code })),
        subscriptionInvoices: tables.invoices.map(mapSubscriptionInvoiceRow),
        subscriptionDiscounts: tables.discounts.map(mapSubscriptionDiscountRow),
        subscriptionAuditLog: tables.auditLog.map(mapSubscriptionAuditRow),
        rolePermissions: tables.rolePermissions,
        dashboardChartConfig: tables.chartConfig,
      };
    },
    createCountry: (payload, principal, auditMeta) => platformService.createCountry(api, payload, principal, auditMeta),
    updateCountry: (code, patch, principal, auditMeta) => platformService.updateCountry(api, code, patch, principal, auditMeta),
    upsertSubscription: (payload, principal, auditMeta) => platformService.upsertSubscription(api, payload, principal, auditMeta),
    createNotification: (payload, principal, auditMeta) => platformService.createNotification(api, payload, principal, auditMeta),
    updateNotification: (id, patch, principal, auditMeta) => platformService.updateNotification(api, id, patch, principal, auditMeta),
    replaceRolePermissions: (map, principal, auditMeta) => platformService.replaceRolePermissions(api, map, principal, auditMeta),
    saveDashboardChartConfig: (config, principal, auditMeta) => platformService.saveDashboardChartConfig(api, config, principal, auditMeta),
    upsertSubscriptionOffer: (payload, principal, auditMeta) => platformService.upsertSubscriptionOffer(api, payload, principal, auditMeta),
    createSubscriptionPayment: (payload, principal, auditMeta) => platformService.createSubscriptionPayment(api, payload, principal, auditMeta),
    updateSubscriptionPayment: (id, patch, principal, auditMeta) => platformService.updateSubscriptionPayment(api, id, patch, principal, auditMeta),
    createSubscriptionDiscount: (payload, principal, auditMeta) => platformService.createSubscriptionDiscount(api, payload, principal, auditMeta),
    updateSubscriptionDiscount: (id, patch, principal, auditMeta) => platformService.updateSubscriptionDiscount(api, id, patch, principal, auditMeta),
    getRolePermissionsMap: async () => {
      const keys = Object.keys(tables.rolePermissions);
      return keys.length ? clone(tables.rolePermissions) : null;
    },
  };

  return api;
}

module.exports = { createPlatformMemoryStore, bootstrapPlatformMemoryFromSeed };
