"use strict";

/**
 * Intégration PostgreSQL — plateforme canonique :
 * isolation tenant, audit transactionnel, persistance role_permissions.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { createPlatformPgStore } = require("../db/platformPgStore");
const { PLATFORM_SCHEMA_SQL } = require("../db/platformSchema");
const { PLATFORM_ERROR } = require("./platformManagement");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const PLATFORM_IT_DATABASE = String(process.env.SOMAFRIK_PLATFORM_IT_DATABASE ?? "somafrik_platform_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const maintenanceUrl = withDatabaseName(databaseUrl, "postgres");
  const pool = new Pool({ connectionString: maintenanceUrl });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) {
      await pool.query(`CREATE DATABASE ${databaseName}`);
    }
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

function createRepo(pool) {
  return {
    async query(sql, params = []) {
      return pool.query(sql, params);
    },
    async one(sql, params = []) {
      const result = await pool.query(sql, params);
      return result.rows[0] ?? null;
    },
    async all(sql, params = []) {
      const result = await pool.query(sql, params);
      return result.rows;
    },
    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx = {
          query: (sql, params) => client.query(sql, params),
          one: async (sql, params) => {
            const result = await client.query(sql, params);
            return result.rows[0] ?? null;
          },
          all: async (sql, params) => {
            const result = await client.query(sql, params);
            return result.rows;
          },
        };
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("platformRepository.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, PLATFORM_IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);
    await pool.query(PLATFORM_SCHEMA_SQL);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const countryBi = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('Burundi', 'BI', '+257', 'BIF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1, 'CD-2026-0001', 'CD-IN-26-001', 'Lycée A', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1, 'BI-2026-0002', 'BI-ESB-26-001', 'Lycée B', 'active') RETURNING id`,
      [countryBi.rows[0].id],
    );

    const repo = createRepo(pool);
    const store = createPlatformPgStore(repo);
    const superAdmin = { role: "Super Administrateur Somafrik", schoolCode: "*", identifier: "superadmin" };
    const schoolAdmin = { role: "Admin School", schoolCode: "CD-IN-26-001", identifier: "admin" };
    const countryAdmin = { role: "Admin Pays", schoolCode: "*", countryCode: "CD", identifier: "country-admin" };
    const auditMeta = { ipAddress: "127.0.0.1", userAgent: "platform-it" };

    const auditBeforeReject = await pool.query("SELECT COUNT(*)::int AS count FROM audit_logs");
    await assert.rejects(
      () =>
        store.upsertSubscription(
          { schoolCode: "BI-ESB-26-001", plan: "Premium", monthlyPrice: 12, currency: "CDF" },
          countryAdmin,
          auditMeta,
        ),
      (error) => error.statusCode === 403,
    );
    const auditAfterReject = await pool.query("SELECT COUNT(*)::int AS count FROM audit_logs");
    assert.equal(auditAfterReject.rows[0].count, auditBeforeReject.rows[0].count, "zero audit on tenant reject");

    const subscription = await store.upsertSubscription(
      { schoolCode: "CD-IN-26-001", plan: "Premium", monthlyPrice: 10, currency: "CDF" },
      schoolAdmin,
      auditMeta,
    );
    assert.equal(subscription.schoolCode, "CD-IN-26-001");

    await assert.rejects(
      () => store.replaceRolePermissions({ "Admin School": ["Voir tableau de bord"] }, superAdmin, auditMeta),
      (error) => error.code === "LEGACY_ROLE_PERMISSIONS_WRITE_FORBIDDEN" && error.statusCode === 403,
    );
    await pool.query(
      `INSERT INTO role_permissions (role_name, permissions, updated_at)
       VALUES ('Admin School', $1::jsonb, NOW())
       ON CONFLICT (role_name) DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = NOW()`,
      [JSON.stringify(["Voir tableau de bord"])],
    );
    const roleMap = await store.getRolePermissionsMap();
    assert.ok(roleMap["Admin School"]);

    const pool2 = new Pool({ connectionString: isolatedUrl });
    const store2 = createPlatformPgStore(createRepo(pool2));
    const roleMapAfterRestart = await store2.getRolePermissionsMap();
    assert.deepEqual(roleMapAfterRestart["Admin School"], ["Voir tableau de bord"]);
    await pool2.end();

    const projection = await store.listProjection();
    assert.ok(projection.subscriptions.some((row) => row.schoolCode === "CD-IN-26-001"));
    assert.ok(projection.rolePermissions["Admin School"]);

    const payment = await store.createSubscriptionPayment(
      { schoolCode: "CD-IN-26-001", amount: 15, currency: "CDF", reference: "PAY-PG-1" },
      schoolAdmin,
      auditMeta,
    );
    assert.equal(payment.schoolCode, "CD-IN-26-001");

    const validatedByCountryAdmin = await store.updateSubscriptionPayment(
      payment.id,
      { status: "Validé" },
      countryAdmin,
      auditMeta,
    );
    assert.equal(validatedByCountryAdmin.status, "Validé");

    const biSchool = await pool.query(`SELECT id FROM schools WHERE school_code = 'BI-2026-0002'`);
    await pool.query(
      `INSERT INTO subscriptions (school_id, plan_name, price_per_student, billing_currency, billing_cycle, status)
       VALUES ($1, 'Standard', 5, 'BIF', 'monthly', 'active')`,
      [biSchool.rows[0].id],
    );
    const biPayment = await pool.query(
      `INSERT INTO subscription_payments (school_id, subscription_id, payment_code, amount, currency, payment_status)
       SELECT $1, sub.id, 'PAY-BI-1', 10, 'BIF', 'pending'
       FROM subscriptions sub WHERE sub.school_id = $1`,
      [biSchool.rows[0].id],
    );
    await assert.rejects(
      () => store.updateSubscriptionPayment("PAY-BI-1", { status: "Validé" }, countryAdmin, auditMeta),
      (error) => error.statusCode === 403,
    );

    const countryNotification = await store.createNotification(
      { title: "National", message: "CD only", type: "Information", countryCode: "CD" },
      countryAdmin,
      auditMeta,
    );
    assert.equal(countryNotification.countryCode, "CD");

    const biCountryAdmin = { role: "Admin Pays", schoolCode: "*", countryCode: "BI", identifier: "bi-admin" };
    await assert.rejects(
      () => store.updateNotification(countryNotification.id, { title: "Hack" }, biCountryAdmin, auditMeta),
      (error) => error.statusCode === 403,
    );

    const archived = await store.updateNotification(
      countryNotification.id,
      { archived: true },
      countryAdmin,
      auditMeta,
    );
    assert.equal(archived.archived, true);
    const remaining = await pool.query("SELECT COUNT(*)::int AS count FROM notifications");
    assert.equal(remaining.rows[0].count, 0);

    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO subscriptions (school_id, plan_name, price_per_student, billing_currency, billing_cycle, status)
           VALUES ($1, 'Duplicate', 1, 'CDF', 'monthly', 'active')`,
          [schoolA.rows[0].id],
        ),
      (error) => /unique|duplicate/i.test(String(error.message)),
      "subscriptions.school_id must be unique",
    );

    const originalWithTransaction = store.withTransaction.bind(store);
    store.withTransaction = (fn) =>
      originalWithTransaction(async (tx) => {
        tx.recordPlatformAudit = async () => {
          throw new Error("audit write failed");
        };
        return fn(tx);
      });
    await assert.rejects(
      () =>
        store.createNotification(
          { title: "Rollback", message: "Test audit rollback", type: "Information" },
          schoolAdmin,
          auditMeta,
        ),
      (error) => String(error.message).includes("audit write failed"),
    );
    store.withTransaction = originalWithTransaction;
    const notifications = await pool.query("SELECT COUNT(*)::int AS count FROM notifications");
    assert.equal(notifications.rows[0].count, 0);

    const createdCountry = await store.createCountry(
      { name: "Testland", code: "TL", phonePrefix: "+999", currency: "USD" },
      superAdmin,
      auditMeta,
    );
    assert.equal(createdCountry.code, "TL");

    console.log("platformRepository.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
