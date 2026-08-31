"use strict";

/**
 * Intégration PostgreSQL — identité de connexion users (PR A).
 * Couvre : index partiels archived, réutilisation post-archivage, provisionContactAccount.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { createClientsPgStore } = require("../db/clientsPgStore");
const { createTxAdapter } = require("../db/txAdapter");
const { ensureSchoolLoginCodeColumn } = require("../db/ensureSchoolLoginCodeColumn");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");
const {
  USERS_LOGIN_IDENTITY_DUPLICATES_CODE,
  ensureUsersLoginIdentityConstraints,
  inventoryUsersLoginIdentityDuplicates,
} = require("./usersLoginIdentity");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_USERS_IDENTITY_IT_DATABASE ?? "somafrik_users_identity_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureDatabase(databaseUrl, databaseName) {
  const maintenance = withDatabaseName(databaseUrl, "postgres");
  const pool = new Pool({ connectionString: maintenance });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

function createRepo(pool) {
  return {
    query: (sql, params) => pool.query(sql, params),
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await pool.query(sql, params)).rows,
    withTransaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx = createTxAdapter(client);
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function seedSchool(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  const school = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, name, status)
     VALUES ($1, 'CD-2026-0001', 'CD-TEST-26-001', 'Test', 'active') RETURNING id`,
    [country.rows[0].id],
  );
  const student = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'STU-ID-1', 'Jean', 'Kabila', 'active') RETURNING id`,
    [school.rows[0].id],
  );
  const actor = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'USR-ACTOR', 'Admin', 'Actor', 'actor.school@test', 'Admin School', 'active')
     RETURNING id`,
    [school.rows[0].id],
  );
  return { schoolId: school.rows[0].id, studentId: student.rows[0].id, actorId: actor.rows[0].id };
}

async function resetSchema(pool) {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
  await pool.query(schema);
  await ensureClientsCanonicalBootstrap(pool, { info() {}, error() {} });
  await ensureSchoolLoginCodeColumn((sql) => pool.query(sql));
}

function assertUsersLoginIdentityDuplicatesError(error, label) {
  assert.notEqual(error?.code, "42702", `${label}: pas d'ambiguïté SQL status`);
  assert.equal(error?.code, USERS_LOGIN_IDENTITY_DUPLICATES_CODE, label);
  assert.match(String(error?.message ?? ""), /doublon/i);
}

async function testEnsureRejectsLegacyDuplicates(pool, db) {
  const { schoolId } = await seedSchool(pool);

  await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'USR-DUP-A', 'Dup', 'A', 'dup.school@test', 'SCHOOL_ADMIN', 'active'),
            ($1, 'USR-DUP-B', 'Dup', 'B', 'dup.school@test', 'SCHOOL_ADMIN', 'active')`,
    [schoolId],
  );
  const schoolEmailInventory = await inventoryUsersLoginIdentityDuplicates(db);
  assert.ok(schoolEmailInventory.duplicateGroups > 0, "inventaire email école détecte le doublon");
  await assert.rejects(
    () => ensureUsersLoginIdentityConstraints(db),
    (error) => {
      assertUsersLoginIdentityDuplicatesError(error, "établissement email");
      return true;
    },
  );

  await resetSchema(pool);
  const { schoolId: schoolIdPhone } = await seedSchool(pool);
  await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, role, status)
     VALUES ($1, 'USR-PH-A', 'Phone', 'A', 'phone.a@test', '+243900000001', 'SCHOOL_ADMIN', 'active'),
            ($1, 'USR-PH-B', 'Phone', 'B', 'phone.b@test', '+243900000001', 'SCHOOL_ADMIN', 'active')`,
    [schoolIdPhone],
  );
  const schoolPhoneInventory = await inventoryUsersLoginIdentityDuplicates(db);
  assert.ok(schoolPhoneInventory.duplicateGroups > 0, "inventaire téléphone école détecte le doublon");
  await assert.rejects(
    () => ensureUsersLoginIdentityConstraints(db),
    (error) => {
      assertUsersLoginIdentityDuplicatesError(error, "établissement téléphone");
      return true;
    },
  );

  await resetSchema(pool);
  await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES (NULL, 'USR-PLAT-E-A', 'Plat', 'A', 'plat.dup@test', 'SUPER_ADMIN', 'active'),
            (NULL, 'USR-PLAT-E-B', 'Plat', 'B', 'plat.dup@test', 'SUPER_ADMIN', 'active')`,
  );
  const platformEmailInventory = await inventoryUsersLoginIdentityDuplicates(db);
  assert.ok(platformEmailInventory.duplicateGroups > 0, "inventaire email plateforme détecte le doublon");
  await assert.rejects(
    () => ensureUsersLoginIdentityConstraints(db),
    (error) => {
      assertUsersLoginIdentityDuplicatesError(error, "plateforme email");
      return true;
    },
  );

  await resetSchema(pool);
  await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, role, status)
     VALUES (NULL, 'USR-PLAT-P-A', 'Plat', 'A', 'plat.phone.a@test', '+243900000002', 'SUPER_ADMIN', 'active'),
            (NULL, 'USR-PLAT-P-B', 'Plat', 'B', 'plat.phone.b@test', '+243900000002', 'SUPER_ADMIN', 'active')`,
  );
  const platformPhoneInventory = await inventoryUsersLoginIdentityDuplicates(db);
  assert.ok(platformPhoneInventory.duplicateGroups > 0, "inventaire téléphone plateforme détecte le doublon");
  await assert.rejects(
    () => ensureUsersLoginIdentityConstraints(db),
    (error) => {
      assertUsersLoginIdentityDuplicatesError(error, "plateforme téléphone");
      return true;
    },
  );
}

async function main() {
  if (!DATABASE_URL) {
    console.log("usersLoginIdentity.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  const db = createRepo(pool);

  try {
    await resetSchema(pool);
    await testEnsureRejectsLegacyDuplicates(pool, db);

    await resetSchema(pool);
    const { schoolId, actorId } = await seedSchool(pool);

    // Actif + archivé même email → inventaire 0 doublon, boot/index OK
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
       VALUES ($1, 'USR-ACTIVE', 'Actif', 'User', 'reuse@school.test', 'SCHOOL_ADMIN', 'active')`,
      [schoolId],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
       VALUES ($1, 'USR-ARCHIVED', 'Archivé', 'User', 'reuse@school.test', 'SCHOOL_ADMIN', 'archived')`,
      [schoolId],
    );

    const inventoryBefore = await inventoryUsersLoginIdentityDuplicates(db);
    assert.equal(
      inventoryBefore.duplicateGroups,
      0,
      "actif+archivé même email ne doit pas compter comme doublon",
    );
    await ensureUsersLoginIdentityConstraints(db);

    const store = createClientsPgStore(db);
    const principal = {
      sub: actorId,
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      identifier: "admin",
    };
    const auditMeta = { ipAddress: "127.0.0.1", userAgent: "test" };

    // Après archivage du compte actif, réutilisation de l'email → création OK
    await pool.query(`UPDATE users SET status = 'archived' WHERE user_code = 'USR-ACTIVE'`);
    const recreated = await store.createUser(
      {
        firstName: "Actif",
        lastName: "User",
        email: "reuse@school.test",
        schoolCode: "CD-2026-0001",
      },
      principal,
      auditMeta,
    );
    assert.equal(recreated.email, "reuse@school.test");
    assert.equal(recreated.assignmentStatus, "Sans affectation");

    // Deux actifs même email → rejet applicatif 409
    await assert.rejects(
      () =>
        store.createUser(
          {
            firstName: "Collision",
            lastName: "Email",
            email: "reuse@school.test",
            schoolCode: "CD-2026-0001",
          },
          principal,
          auditMeta,
        ),
      (error) => error.statusCode === 409 && error.code === "DUPLICATE",
      "deux comptes actifs même email → 409",
    );

    // provisionContactAccount : collision email avec compte actif existant
    const blockingUser = await store.createUser(
      {
        firstName: "Bloque",
        lastName: "Parent",
        email: "parent.block@test",
        phone: "+243900000010",
        schoolCode: "CD-2026-0001",
      },
      principal,
      auditMeta,
    );
    assert.ok(blockingUser.id);

    const blockedContact = await store.createContact(
      {
        firstName: "Contact",
        lastName: "Bloqué",
        contactType: "Parent",
        email: "parent.block@test",
        phone: "+243900000010",
        schoolCode: "CD-2026-0001",
      },
      principal,
      auditMeta,
    );

    const provisioned = await store.provisionContactAccount(
      blockedContact.id,
      { role: "Parent" },
      principal,
      auditMeta,
    );
    assert.equal(provisioned.reused, true, "provision rattache le contact au compte existant");
    assert.equal(provisioned.created, false);
    assert.equal(provisioned.user.id, blockingUser.id);
    const usersWithEmail = await pool.query(
      `SELECT COUNT(*)::int AS count FROM users
       WHERE lower(coalesce(email, '')) = lower($1) AND status = 'active'`,
      ["parent.block@test"],
    );
    assert.equal(usersWithEmail.rows[0].count, 1, "compte unique : pas de second user pour le même email");

    // Concurrence provisioning : un seul user créé
    const raceContact = await store.createContact(
      {
        firstName: "Race",
        lastName: "Parent",
        contactType: "Parent",
        email: "race.parent@test",
        phone: "+243900000099",
        schoolCode: "CD-2026-0001",
      },
      principal,
      auditMeta,
    );
    const beforeUsers = await pool.query(`SELECT COUNT(*)::int AS count FROM users`);
    const [raceA, raceB] = await Promise.all([
      store.provisionContactAccount(raceContact.id, { role: "Parent" }, principal, auditMeta),
      store.provisionContactAccount(raceContact.id, { role: "Parent" }, principal, auditMeta),
    ]);
    const afterUsers = await pool.query(`SELECT COUNT(*)::int AS count FROM users`);
    assert.equal(afterUsers.rows[0].count - beforeUsers.rows[0].count, 1, "un seul user en concurrence");
    assert.equal([raceA, raceB].filter((row) => row.created).length, 1);
    assert.equal(raceA.user.id, raceB.user.id);

    console.log("usersLoginIdentity.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
