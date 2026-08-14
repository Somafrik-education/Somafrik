"use strict";

/**
 * Intégration PostgreSQL — identité de connexion users (PR A).
 * Couvre : index partiels archived, réutilisation post-archivage, provisionContactAccount.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { CLIENTS_SCHEMA_SQL } = require("../db/clientsSchema");
const { createClientsPgStore } = require("../db/clientsPgStore");
const { createTxAdapter } = require("../db/txAdapter");
const {
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
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'CD-2026-0001', 'Test', 'active') RETURNING id`,
    [country.rows[0].id],
  );
  const student = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'STU-ID-1', 'Jean', 'Kabila', 'active') RETURNING id`,
    [school.rows[0].id],
  );
  return { schoolId: school.rows[0].id, studentId: student.rows[0].id };
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
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);
    await pool.query(CLIENTS_SCHEMA_SQL);

    const { schoolId } = await seedSchool(pool);

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
    const principal = { role: "Admin School", schoolCode: "CD-2026-0001", identifier: "admin" };
    const auditMeta = { ipAddress: "127.0.0.1", userAgent: "test" };

    // Après archivage du compte actif, réutilisation de l'email → création OK
    await pool.query(`UPDATE users SET status = 'archived' WHERE user_code = 'USR-ACTIVE'`);
    const recreated = await store.createUser(
      {
        firstName: "Nouveau",
        lastName: "Compte",
        role: "Secrétaire",
        email: "reuse@school.test",
        schoolCode: "CD-2026-0001",
      },
      principal,
      auditMeta,
    );
    assert.equal(recreated.email, "reuse@school.test");

    // Deux actifs même email → rejet applicatif 409
    await assert.rejects(
      () =>
        store.createUser(
          {
            firstName: "Collision",
            lastName: "Email",
            role: "Secrétaire",
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
        role: "Parent",
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

    await assert.rejects(
      () => store.provisionContactAccount(blockedContact.id, { role: "Parent" }, principal, auditMeta),
      (error) => error.statusCode === 409 && error.code === "DUPLICATE",
      "provisionContactAccount rejette email/téléphone déjà actifs",
    );

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
