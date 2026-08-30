"use strict";

const platformService = require("../lib/platformService");
const {
  asTrimmed,
  parsePayload,
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
} = require("../lib/platformManagement");

function createPlatformPgStore(repo) {
  function bind(client) {
    const one = (sql, params) => (client.one ? client.one(sql, params) : repo.one(sql, params));
    const all = (sql, params) => (client.all ? client.all(sql, params) : repo.all(sql, params));
    const query = (sql, params) => (client.query ? client.query(sql, params) : repo.query(sql, params));

    return {
      async getSchoolByCode(code) {
        const { canonicalSchoolLoginOrNull } = require("../lib/schoolCodeV2");
        const normalized = canonicalSchoolLoginOrNull(code);
        if (!normalized) return null;
        const row = await one(
          `SELECT s.*, s.login_code AS school_code, c.iso_code AS country_code, c.name AS country_name
           FROM schools s
           JOIN countries c ON c.id = s.country_id
           WHERE upper(s.login_code) = $1
           LIMIT 1`,
          [normalized],
        );
        return row || null;
      },
      async getCountryByCode(code) {
        return one("SELECT * FROM countries WHERE iso_code = $1", [asTrimmed(code).toUpperCase()]);
      },
      async insertCountry({ name, isoCode, phonePrefix, currency, isActive, profile }) {
        return one(
          `INSERT INTO countries (name, iso_code, phone_code, currency, is_active, profile_payload, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW())
           RETURNING *`,
          [name, isoCode, phonePrefix, currency, isActive, JSON.stringify({ ...(profile ?? {}) })],
        );
      },
      async updateCountry(code, { name, phonePrefix, currency, isActive, profile }) {
        const existing = await this.getCountryByCode(code);
        const mergedProfile = { ...parsePayload(existing?.profile_payload), ...(profile ?? {}) };
        return one(
          `UPDATE countries
           SET name = $2, phone_code = $3, currency = $4, is_active = $5,
               profile_payload = $6::jsonb, updated_at = NOW()
           WHERE iso_code = $1
           RETURNING *`,
          [code, name, phonePrefix, currency, isActive, JSON.stringify(mergedProfile)],
        );
      },
      async getSubscriptionBySchoolId(schoolId) {
        return one("SELECT * FROM subscriptions WHERE school_id = $1 ORDER BY created_at DESC LIMIT 1", [schoolId]);
      },
      async insertSubscription(row) {
        return one(
          `INSERT INTO subscriptions (
             school_id, plan_name, price_per_student, billing_currency, billing_cycle, status, start_date, end_date, profile_payload, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW(),NOW())
           RETURNING *`,
          [
            row.schoolId,
            row.planName,
            row.pricePerStudent,
            row.billingCurrency,
            row.billingCycle,
            row.status,
            row.startDate || null,
            row.endDate || null,
            JSON.stringify(row.profile ?? {}),
          ],
        );
      },
      async updateSubscription(id, row) {
        const existing = await one("SELECT * FROM subscriptions WHERE id = $1", [id]);
        const mergedProfile = { ...parsePayload(existing?.profile_payload), ...(row.profile ?? {}) };
        return one(
          `UPDATE subscriptions
           SET plan_name = $2, price_per_student = $3, billing_currency = $4, billing_cycle = $5,
               status = $6, start_date = $7, end_date = $8, profile_payload = $9::jsonb, updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [
            id,
            row.planName,
            row.pricePerStudent,
            row.billingCurrency,
            row.billingCycle,
            row.status,
            row.startDate || null,
            row.endDate || null,
            JSON.stringify(mergedProfile),
          ],
        );
      },
      async getNotificationById(id, principal, { lock } = {}) {
        const params = [id, id];
        let sql = `
          SELECT n.*, s.login_code AS school_code, COALESCE(c.iso_code, n.profile_payload->>'countryCode') AS country_code
          FROM notifications n
          LEFT JOIN schools s ON s.id = n.school_id
          LEFT JOIN countries c ON c.id = s.country_id
          WHERE n.id::text = $1 OR COALESCE(n.profile_payload->>'publicId','') = $2
        `;
        if (lock) sql += " FOR UPDATE OF n";
        sql += " LIMIT 1";
        return one(sql, params);
      },
      async insertNotification(row) {
        return one(
          `INSERT INTO notifications (school_id, title, message, type, channel, status, sent_at, profile_payload, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7::jsonb,NOW(),NOW())
           RETURNING *, $8::text AS school_code`,
          [
            row.schoolId,
            row.title,
            row.message,
            row.type,
            row.channel,
            row.status,
            JSON.stringify(row.profile ?? {}),
            row.profile?.schoolCode ?? null,
          ],
        );
      },
      async updateNotification(id, row) {
        if (row.archived) {
          await query("DELETE FROM notifications WHERE id = $1", [id]);
          return null;
        }
        const existing = await one("SELECT * FROM notifications WHERE id = $1", [id]);
        const mergedProfile = { ...parsePayload(existing?.profile_payload), ...(row.profile ?? {}) };
        return one(
          `UPDATE notifications
           SET title = $2, message = $3, type = $4, status = $5, read_at = $6,
               profile_payload = $7::jsonb, updated_at = NOW()
           WHERE id = $1
           RETURNING *, (SELECT login_code FROM schools WHERE id = notifications.school_id) AS school_code`,
          [id, row.title, row.message, row.type, row.status, row.readAt || null, JSON.stringify(mergedProfile)],
        );
      },
      async listRolePermissions() {
        const rows = await all("SELECT role_name, permissions FROM role_permissions ORDER BY role_name");
        return mapRolePermissionsRows(rows);
      },
      async replaceRolePermissions(map) {
        for (const roleName of Object.keys(map)) {
          const permissions = Array.isArray(map[roleName]) ? map[roleName] : [];
          await query(
            `INSERT INTO role_permissions (role_name, permissions, updated_at)
             VALUES ($1, $2::jsonb, NOW())
             ON CONFLICT (role_name) DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = NOW()`,
            [roleName, JSON.stringify(permissions)],
          );
        }
        return this.listRolePermissions();
      },
      async getDashboardChartConfig() {
        const rows = await all("SELECT scope_key, chart_overrides FROM dashboard_chart_config");
        return mapDashboardChartConfigRows(rows);
      },
      async saveDashboardChartConfig(config) {
        await query(
          `INSERT INTO dashboard_chart_config (scope_key, chart_overrides, updated_at)
           VALUES ('platform', $1::jsonb, NOW())
           ON CONFLICT (scope_key) DO UPDATE SET chart_overrides = EXCLUDED.chart_overrides, updated_at = NOW()`,
          [JSON.stringify(config.platform ?? {})],
        );
        await query(
          `INSERT INTO dashboard_chart_config (scope_key, chart_overrides, updated_at)
           VALUES ('establishment', $1::jsonb, NOW())
           ON CONFLICT (scope_key) DO UPDATE SET chart_overrides = EXCLUDED.chart_overrides, updated_at = NOW()`,
          [JSON.stringify(config.establishment ?? {})],
        );
        return this.getDashboardChartConfig();
      },
      async getOfferByCode(code) {
        return one("SELECT * FROM subscription_offers WHERE offer_code = $1", [asTrimmed(code)]);
      },
      async insertOffer({ offerCode, countryCodes, active, profile }) {
        return one(
          `INSERT INTO subscription_offers (offer_code, country_codes, active, profile_payload, created_at, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
           RETURNING *`,
          [offerCode, countryCodes, active, JSON.stringify(profile ?? {})],
        );
      },
      async updateOffer(offerCode, { countryCodes, active, profile }) {
        const existing = await this.getOfferByCode(offerCode);
        const mergedProfile = { ...parsePayload(existing?.profile_payload), ...(profile ?? {}) };
        return one(
          `UPDATE subscription_offers
           SET country_codes = $2, active = $3, profile_payload = $4::jsonb, updated_at = NOW()
           WHERE offer_code = $1
           RETURNING *`,
          [offerCode, countryCodes, active, JSON.stringify(mergedProfile)],
        );
      },
      async getSubscriptionPaymentByCode(code, principal, { lock } = {}) {
        let sql = `
          SELECT p.*, s.login_code AS school_code
          FROM subscription_payments p
          JOIN schools s ON s.id = p.school_id
          WHERE p.payment_code = $1 OR p.id::text = $1
        `;
        if (lock) sql += " FOR UPDATE OF p";
        sql += " LIMIT 1";
        return one(sql, [code]);
      },
      async insertSubscriptionPayment(row) {
        return one(
          `INSERT INTO subscription_payments (
             school_id, subscription_id, payment_code, amount, currency, payment_status, profile_payload, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW(),NOW())
           RETURNING *`,
          [
            row.schoolId,
            row.subscriptionId,
            row.paymentCode,
            row.amount,
            row.currency,
            row.paymentStatus,
            JSON.stringify(row.profile ?? {}),
          ],
        );
      },
      async updateSubscriptionPayment(id, row) {
        const existing = await one("SELECT * FROM subscription_payments WHERE id = $1", [id]);
        const mergedProfile = { ...parsePayload(existing?.profile_payload), ...(row.profile ?? {}) };
        return one(
          `UPDATE subscription_payments
           SET payment_status = $2, profile_payload = $3::jsonb, updated_at = NOW()
           WHERE id = $1
           RETURNING *, (SELECT login_code FROM schools WHERE id = subscription_payments.school_id) AS school_code`,
          [id, row.paymentStatus, JSON.stringify(mergedProfile)],
        );
      },
      async getSubscriptionDiscountById(id, principal, { lock } = {}) {
        let sql = `
          SELECT d.*, s.login_code AS school_code
          FROM subscription_discounts d
          LEFT JOIN schools s ON s.id = d.school_id
          WHERE d.id::text = $1 OR COALESCE(d.profile_payload->>'id','') = $1
        `;
        if (lock) sql += " FOR UPDATE OF d";
        sql += " LIMIT 1";
        return one(sql, [id]);
      },
      async insertSubscriptionDiscount(row) {
        return one(
          `INSERT INTO subscription_discounts (school_id, offer_id, status, profile_payload, created_at, updated_at)
           VALUES ($1, (SELECT id FROM subscription_offers WHERE offer_code = $2 OR id::text = $2 LIMIT 1), $3, $4::jsonb, NOW(), NOW())
           RETURNING *, (SELECT login_code FROM schools WHERE id = subscription_discounts.school_id) AS school_code`,
          [row.schoolId, row.offerId || null, row.status, JSON.stringify(row.profile ?? {})],
        );
      },
      async updateSubscriptionDiscount(id, row) {
        const existing = await one("SELECT * FROM subscription_discounts WHERE id = $1", [id]);
        const mergedProfile = { ...parsePayload(existing?.profile_payload), ...(row.profile ?? {}) };
        return one(
          `UPDATE subscription_discounts
           SET status = $2, profile_payload = $3::jsonb, updated_at = NOW()
           WHERE id = $1
           RETURNING *, (SELECT login_code FROM schools WHERE id = subscription_discounts.school_id) AS school_code`,
          [id, row.status, JSON.stringify(mergedProfile)],
        );
      },
      async insertSubscriptionAudit({ schoolId, subscriptionId, action, profile }) {
        await query(
          `INSERT INTO subscription_audit_log (school_id, subscription_id, action, profile_payload, created_at)
           VALUES ($1, $2, $3, $4::jsonb, NOW())`,
          [schoolId || null, subscriptionId || null, action, JSON.stringify(profile ?? {})],
        );
      },
      async resolveActorUserId(principal) {
        const normalized = asTrimmed(principal?.sub || principal?.id);
        if (!normalized) return null;
        if (/^[0-9a-f-]{36}$/i.test(normalized)) {
          const row = await one("SELECT id FROM users WHERE id = $1", [normalized]);
          if (row) return row.id;
        }
        const row = await one("SELECT id FROM users WHERE user_code = $1 OR email = $1 LIMIT 1", [normalized]);
        return row?.id ?? null;
      },
      async recordPlatformAudit({ schoolCode, userId, action, entityType, entityId, oldValue, newValue, ipAddress, userAgent }) {
        const school = schoolCode && schoolCode !== "*" ? await this.getSchoolByCode(schoolCode) : null;
        const actorId = await this.resolveActorUserId({ sub: userId });
        await query(
          `INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
          [
            school?.id ?? null,
            actorId,
            action,
            entityType,
            entityId ?? null,
            oldValue ? JSON.stringify(oldValue) : null,
            newValue ? JSON.stringify(newValue) : null,
            ipAddress ?? "",
            userAgent ?? "",
          ],
        );
      },
    };
  }

  const api = {
    withTransaction(fn) {
      return repo.withTransaction((tx) => fn(bind(tx)));
    },
    getSchoolByCode: (code) => bind(repo).getSchoolByCode(code),
    getCountryByCode: (code) => bind(repo).getCountryByCode(code),
    async listProjection() {
      const [
        countryRows,
        subscriptionRows,
        notificationRows,
        offerRows,
        paymentRows,
        invoiceRows,
        discountRows,
        auditRows,
        roleRows,
        chartRows,
      ] = await Promise.all([
        repo.all("SELECT * FROM countries ORDER BY created_at, iso_code"),
        repo.all(
          `SELECT sub.*, s.login_code AS school_code, c.iso_code AS country_code, c.name AS country_name
           FROM subscriptions sub
           JOIN schools s ON s.id = sub.school_id
           JOIN countries c ON c.id = s.country_id
           ORDER BY sub.created_at`,
        ),
        repo.all(
          `SELECT n.*, s.login_code AS school_code, COALESCE(c.iso_code, n.profile_payload->>'countryCode') AS country_code
           FROM notifications n
           LEFT JOIN schools s ON s.id = n.school_id
           LEFT JOIN countries c ON c.id = s.country_id
           ORDER BY n.created_at DESC`,
        ),
        repo.all("SELECT * FROM subscription_offers ORDER BY created_at"),
        repo.all(
          `SELECT p.*, s.login_code AS school_code
           FROM subscription_payments p
           JOIN schools s ON s.id = p.school_id
           ORDER BY p.created_at DESC`,
        ),
        repo.all(
          `SELECT i.*, s.login_code AS school_code
           FROM subscription_invoices i
           JOIN schools s ON s.id = i.school_id
           ORDER BY i.created_at DESC`,
        ),
        repo.all(
          `SELECT d.*, s.login_code AS school_code
           FROM subscription_discounts d
           LEFT JOIN schools s ON s.id = d.school_id
           ORDER BY d.created_at DESC`,
        ),
        repo.all(
          `SELECT a.*, s.login_code AS school_code
           FROM subscription_audit_log a
           LEFT JOIN schools s ON s.id = a.school_id
           ORDER BY a.created_at DESC
           LIMIT 200`,
        ),
        repo.all("SELECT role_name, permissions FROM role_permissions ORDER BY role_name"),
        repo.all("SELECT scope_key, chart_overrides FROM dashboard_chart_config"),
      ]);

      return {
        countries: countryRows.map(mapCountryRow),
        subscriptions: subscriptionRows.map(mapSubscriptionRow),
        notifications: notificationRows.map(mapNotificationRow),
        subscriptionOffers: offerRows.map(mapOfferRow),
        subscriptionPayments: paymentRows.map(mapSubscriptionPaymentRow),
        subscriptionInvoices: invoiceRows.map(mapSubscriptionInvoiceRow),
        subscriptionDiscounts: discountRows.map(mapSubscriptionDiscountRow),
        subscriptionAuditLog: auditRows.map(mapSubscriptionAuditRow),
        rolePermissions: mapRolePermissionsRows(roleRows),
        dashboardChartConfig: mapDashboardChartConfigRows(chartRows),
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
      const rows = await repo.all("SELECT role_name, permissions FROM role_permissions ORDER BY role_name");
      const map = mapRolePermissionsRows(rows);
      return Object.keys(map).length ? map : null;
    },
  };

  return api;
}

module.exports = { createPlatformPgStore };
