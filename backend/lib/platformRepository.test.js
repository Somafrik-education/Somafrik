"use strict";

const assert = require("node:assert/strict");
const { createPlatformMemoryStore } = require("../db/platformMemoryStore");

async function main() {
  const auditLogs = [];
  const store = createPlatformMemoryStore({
    getSchoolByCode: async (code) => ({
      id: code === "BI-2026-0002" ? "school-2" : "school-1",
      school_code: code,
      code,
      schoolCode: code,
      country_code: code.startsWith("BI") ? "BI" : "CD",
      country_name: code.startsWith("BI") ? "Burundi" : "RDC",
      currency: "CDF",
    }),
    getCountryByCode: async (code) => ({
      id: "country-1",
      code,
      name: "RDC",
      phonePrefix: "+243",
      currency: "CDF",
      status: "Actif",
    }),
  });

  const superAdmin = { role: "Super Administrateur Somafrik", schoolCode: "*", identifier: "superadmin" };
  const schoolAdmin = { role: "Admin School", schoolCode: "CD-2026-0001", identifier: "admin" };
  const foreignAdmin = { role: "Admin School", schoolCode: "BI-2026-0002", identifier: "foreign" };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "test" };

  const originalWithTransaction = store.withTransaction.bind(store);
  store.withTransaction = (fn) =>
    originalWithTransaction(async (tx) => {
      tx.recordPlatformAudit = async (entry) => {
        auditLogs.push(entry);
      };
      return fn(tx);
    });

  const country = await store.createCountry(
    { name: "Burundi", code: "BI", phonePrefix: "+257", currency: "BIF" },
    superAdmin,
    auditMeta,
  );
  assert.equal(country.code, "BI");

  const countryAdmin = { role: "Admin Pays", schoolCode: "*", countryCode: "CD", identifier: "country-admin" };

  await assert.rejects(
    () =>
      store.upsertSubscription(
        { schoolCode: "BI-2026-0002", plan: "Premium", monthlyPrice: 12, currency: "CDF" },
        countryAdmin,
        auditMeta,
      ),
    (error) => error.statusCode === 403,
  );
  assert.equal(auditLogs.length, 1, "no audit on tenant rejection");

  const subscription = await store.upsertSubscription(
    { schoolCode: "CD-2026-0001", plan: "Premium", monthlyPrice: 10, currency: "CDF" },
    schoolAdmin,
    auditMeta,
  );
  assert.equal(subscription.schoolCode, "CD-2026-0001");

  const notification = await store.createNotification(
    { title: "Test", message: "Hello", type: "Information" },
    schoolAdmin,
    auditMeta,
  );
  assert.equal(notification.title, "Test");

  await assert.rejects(
    () => store.replaceRolePermissions({ "Admin School": ["Voir tableau de bord"] }, superAdmin, auditMeta),
    (error) => error.code === "LEGACY_ROLE_PERMISSIONS_WRITE_FORBIDDEN" && error.statusCode === 403,
  );

  const projection = await store.listProjection();
  assert.ok(projection.countries.some((row) => row.code === "BI"));
  assert.ok(projection.subscriptions.length >= 1);
  assert.ok(projection.notifications.length >= 1);

  const payment = await store.createSubscriptionPayment(
    { schoolCode: "CD-2026-0001", amount: 25, currency: "CDF", reference: "PAY-TEST-1" },
    schoolAdmin,
    auditMeta,
  );
  assert.equal(payment.schoolCode, "CD-2026-0001");

  await assert.rejects(
    () =>
      store.updateSubscriptionPayment(
        payment.id,
        { status: "Validé" },
        foreignAdmin,
        auditMeta,
      ),
    (error) => error.statusCode === 403,
  );

  const countryNotification = await store.createNotification(
    { title: "Alerte pays", message: "National", type: "Information", countryCode: "CD" },
    countryAdmin,
    auditMeta,
  );
  assert.equal(countryNotification.countryCode, "CD");

  const foreignCountryAdmin = { role: "Admin Pays", schoolCode: "*", countryCode: "BI", identifier: "bi-admin" };
  await assert.rejects(
    () =>
      store.updateNotification(countryNotification.id, { title: "Intrusion" }, foreignCountryAdmin, auditMeta),
    (error) => error.statusCode === 403,
  );

  const archived = await store.updateNotification(
    countryNotification.id,
    { archived: true },
    countryAdmin,
    auditMeta,
  );
  assert.equal(archived.archived, true);

  console.log("platformRepository.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
