"use strict";

const assert = require("node:assert/strict");
const { createPlatformMemoryStore } = require("../db/platformMemoryStore");
const { PLATFORM_SCHEMA_SQL } = require("../db/platformSchema");
const { USER_ROLES_SCHEMA_SQL } = require("../db/userRolesSchema");
const {
  attachCanonicalDemoSeedPostgres,
  extractFixtureSchoolShortCode,
  isAcademicStudentUserInsertSql,
  isStudentSeedUser,
} = require("../db/demoSeedPostgres");
const { shouldSeedDemoData } = require("./demoSeedPolicy");
const seedData = require("../data");

function assertDemoSubscriptionSeedIntegrity() {
  const seedEnabled = shouldSeedDemoData({
    NODE_ENV: "development",
    SOMAFRIK_SKIP_DEMO_SEED: "false",
  });
  assert.equal(seedEnabled, true);

  const schoolByCode = new Map(seedData.platformSchools.map((school) => [school.code, school]));
  const subscriptionSchoolCodes = seedData.subscriptions.map((subscription) => subscription.schoolCode);

  assert.equal(
    seedData.subscriptions.length,
    seedData.platformSchools.length,
    "le seed doit produire exactement un abonnement par établissement",
  );
  assert.equal(
    new Set(subscriptionSchoolCodes).size,
    seedData.subscriptions.length,
    "aucun établissement ne doit avoir plusieurs abonnements dans le seed",
  );

  for (const subscription of seedData.subscriptions) {
    const school = schoolByCode.get(subscription.schoolCode);
    assert.ok(school, `abonnement orphelin interdit: ${subscription.id}`);
    assert.equal(subscription.countryCode, school.countryCode);
  }

  for (const school of seedData.platformSchools) {
    assert.equal(
      seedData.subscriptions.filter((subscription) => subscription.schoolCode === school.code).length,
      1,
      `un abonnement attendu pour ${school.code}`,
    );
  }

  assert.match(
    PLATFORM_SCHEMA_SQL,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_school_id\s+ON subscriptions \(school_id\)/,
    "la contrainte PostgreSQL uq_subscriptions_school_id doit rester intacte",
  );
}

async function assertCanonicalDemoIdentitySeedIntegrity() {
  const primarySchool = seedData.platformSchools.find((school) => school.code === "CD-2026-0001");
  assert.ok(primarySchool, "fixture établissement principal attendue");
  assert.equal(primarySchool.loginCode, "CD-IN-26-001");
  assert.equal(extractFixtureSchoolShortCode(primarySchool), "IN");
  assert.equal(isStudentSeedUser({ role: "Élève / Étudiant" }), true);
  assert.equal(isStudentSeedUser({ role: "STUDENT" }), true);
  assert.equal(isStudentSeedUser({ role: "Admin School" }), false);

  assert.match(
    USER_ROLES_SCHEMA_SQL,
    /base_initials := upper\(btrim\(coalesce\(NEW\.short_code, ''\)\)\)/,
    "le login établissement doit utiliser short_code comme source d'initiales",
  );

  const original = {
    countries: seedData.countries.slice(),
    platformSchools: seedData.platformSchools.slice(),
    subscriptions: seedData.subscriptions.slice(),
    userAccounts: seedData.userAccounts.slice(),
  };
  const admin = seedData.userAccounts.find((user) => user.role === "Admin School" && user.schoolCode === primarySchool.code);
  const student = seedData.userAccounts.find((user) => isStudentSeedUser(user));
  const subscription = seedData.subscriptions.find((item) => item.schoolCode === primarySchool.code);
  assert.ok(admin && student && subscription, "fixtures minimales seed attendues");

  const writes = [];
  const fakeRepository = {
    seedReferenceData: async () => {
      throw new Error("seedReferenceData original ne doit plus être appelé");
    },
    getCountryCodeForSchool: (school) => school.countryCode || (school.country === "RDC" ? "CD" : ""),
    insertOne: async (_client, sql, params) => {
      writes.push({ sql, params });
      return { id: `row-${writes.length}` };
    },
    toDbStatus: () => "active",
    toSubscriptionStatus: () => "active",
    parseDate: (value) => value || null,
  };
  const fakeClient = {
    query: async (sql, params) => {
      writes.push({ sql, params });
      return { rows: [] };
    },
  };

  try {
    seedData.countries.splice(0, seedData.countries.length, original.countries.find((country) => country.code === "CD"));
    seedData.platformSchools.splice(0, seedData.platformSchools.length, primarySchool);
    seedData.subscriptions.splice(0, seedData.subscriptions.length, subscription);
    seedData.userAccounts.splice(0, seedData.userAccounts.length, admin, student);

    attachCanonicalDemoSeedPostgres(fakeRepository);
    const maps = await fakeRepository.seedReferenceData(fakeClient);

    const schoolWrite = writes.find((entry) => /INSERT INTO schools/.test(entry.sql));
    assert.ok(schoolWrite, "INSERT schools attendu");
    assert.match(schoolWrite.sql, /school_code, short_code, name/);
    assert.equal(schoolWrite.params[2], "IN");

    const userWrites = writes.filter((entry) => /INSERT INTO users/.test(entry.sql));
    assert.equal(userWrites.length, 1, "le compte élève ne doit pas être créé avant students");
    assert.notEqual(userWrites[0].params[8], "STUDENT");
    assert.equal(maps.userIds.has(student.id), false);
    assert.equal(maps.userIds.has(admin.id), true);
  } finally {
    seedData.countries.splice(0, seedData.countries.length, ...original.countries);
    seedData.platformSchools.splice(0, seedData.platformSchools.length, ...original.platformSchools);
    seedData.subscriptions.splice(0, seedData.subscriptions.length, ...original.subscriptions);
    seedData.userAccounts.splice(0, seedData.userAccounts.length, ...original.userAccounts);
  }
}

async function assertAcademicStudentAccountSeedIntegrity() {
  const academicWrites = [];
  const ensureWrites = [];
  const studentUserSql = `
    INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status)
    VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, 'STUDENT', $8)
  `;
  assert.equal(isAcademicStudentUserInsertSql(studentUserSql), true);
  assert.equal(isAcademicStudentUserInsertSql("INSERT INTO users (role) VALUES ('TEACHER')"), false);

  const fakeRepository = {
    seedReferenceData: async () => ({}),
    seedAcademicData: async (client) => {
      await client.query("INSERT INTO students (student_code) VALUES ($1)", ["CD-IN-EL-26-001"]);
      await client.query(studentUserSql, ["school-1", "CD-IN-EL-26-001"]);
      await client.query("INSERT INTO enrollments (student_id) VALUES ($1)", ["student-1"]);
      return "academic-ok";
    },
    ensureStudentUsers: async () => {
      throw new Error("ensureStudentUsers legacy ne doit plus être appelé");
    },
    query: async (sql, params) => {
      ensureWrites.push({ sql, params });
      return { rows: [], rowCount: 1 };
    },
  };
  const fakeClient = {
    query: async (sql, params) => {
      academicWrites.push({ sql, params });
      return { rows: [], rowCount: 1 };
    },
  };

  attachCanonicalDemoSeedPostgres(fakeRepository);
  const result = await fakeRepository.seedAcademicData(fakeClient, {});
  assert.equal(result, "academic-ok");
  assert.ok(academicWrites.some((entry) => /INSERT INTO students/.test(entry.sql)));
  assert.ok(academicWrites.some((entry) => /INSERT INTO enrollments/.test(entry.sql)));
  assert.equal(
    academicWrites.some((entry) => isAcademicStudentUserInsertSql(entry.sql)),
    false,
    "seedAcademicData ne doit plus écrire de compte STUDENT",
  );

  await fakeRepository.ensureStudentUsers();
  assert.equal(ensureWrites.length, 1);
  const accountWrite = ensureWrites[0].sql;
  assert.match(accountWrite, /st\.student_code/);
  assert.match(accountWrite, /NULL::text, NULL::text/);
  assert.doesNotMatch(accountWrite, /st\.parent_email/);
  assert.doesNotMatch(accountWrite, /st\.parent_phone/);
  assert.match(accountWrite, /'STUDENT'/);
}

async function main() {
  assertDemoSubscriptionSeedIntegrity();
  await assertCanonicalDemoIdentitySeedIntegrity();
  await assertAcademicStudentAccountSeedIntegrity();

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

  const subscriptionRow = await store.upsertSubscription(
    { schoolCode: "CD-2026-0001", plan: "Premium", monthlyPrice: 10, currency: "CDF" },
    schoolAdmin,
    auditMeta,
  );
  assert.equal(subscriptionRow.schoolCode, "CD-2026-0001");

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