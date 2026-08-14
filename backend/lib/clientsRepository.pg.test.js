"use strict";

/**
 * Intégration PostgreSQL — clients/comptes LOT 7.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { CLIENTS_SCHEMA_SQL } = require("../db/clientsSchema");
const { createClientsPgStore } = require("../db/clientsPgStore");
const { createTxAdapter } = require("../db/txAdapter");
const { hashSecret, verifySecret } = require("../services/credentialService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_CLIENTS_IT_DATABASE ?? "somafrik_clients_it")
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

async function main() {
  if (!DATABASE_URL) {
    console.log("clientsRepository.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);
    await pool.query(CLIENTS_SCHEMA_SQL);

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
       VALUES ($1, 'STU-LOT7-1', 'Jean', 'Kabila', 'active') RETURNING id`,
      [school.rows[0].id],
    );

    const repo = createRepo(pool);
    const store = createClientsPgStore(repo);
    const principal = {
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      identifier: "admin",
    };
    const auditMeta = { ipAddress: "127.0.0.1", userAgent: "test" };

    const contact = await store.createContact(
      {
        firstName: "Marie",
        lastName: "Parent",
        contactType: "Parent",
        phone: "+243900000001",
        schoolCode: "CD-2026-0001",
      },
      principal,
      auditMeta,
    );
    assert.ok(contact.id);

    const provisioned = await store.provisionContactAccount(
      contact.id,
      { role: "Parent", studentId: student.rows[0].id },
      principal,
      auditMeta,
    );
    assert.equal(provisioned.created, true);
    assert.ok(provisioned.temporaryPassword);
    assert.ok(provisioned.user.id);
    assert.equal(provisioned.relation?.toStudentId, student.rows[0].id);

    assert.ok(!provisioned.user.passwordHash);
    assert.ok(!provisioned.user.pinHash);

    const userRow = await pool.query(`SELECT password_hash, must_change_password FROM users WHERE id = $1`, [
      provisioned.user.id,
    ]);
    assert.ok(userRow.rows[0].password_hash.startsWith("scrypt$"));
    assert.equal(userRow.rows[0].must_change_password, true);
    assert.ok(verifySecret(provisioned.temporaryPassword, userRow.rows[0].password_hash));

    const secondProvision = await store.provisionContactAccount(
      contact.id,
      { role: "Parent", studentId: student.rows[0].id },
      principal,
      auditMeta,
    );
    assert.equal(secondProvision.created, false);
    assert.equal(secondProvision.user.id, provisioned.user.id);

    const relationCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM contact_relations WHERE contact_id = $1`,
      [contact.id],
    );
    assert.equal(relationCount.rows[0].count, 1);

    const announcement = await store.createAnnouncement(
      {
        title: "Réunion",
        message: "Parents invités",
        audience: "Parents",
        schoolCode: "CD-2026-0001",
      },
      principal,
      auditMeta,
    );
    assert.equal(announcement.title, "Réunion");

    const projection = await store.listProjection();
    assert.ok(projection.users.some((row) => row.id === provisioned.user.id));
    assert.ok(projection.contacts.some((row) => row.id === contact.id));
    assert.ok(projection.relations.length >= 1);
    assert.ok(projection.announcements.some((row) => row.id === announcement.id));

    const restartProjection = await store.listProjection();
    assert.equal(restartProjection.users.length, projection.users.length);

    await assert.rejects(
      () =>
        store.createUser(
          {
            firstName: "Escalade",
            lastName: "Admin",
            role: "Super Administrateur Somafrik",
            schoolCode: "CD-2026-0001",
          },
          principal,
          auditMeta,
        ),
      (error) => error.statusCode === 403 && error.code === "FORBIDDEN",
      "Admin School ne crée pas de Super Admin",
    );

    const raceContact = await store.createContact(
      {
        firstName: "Race",
        lastName: "Parent",
        contactType: "Parent",
        phone: "+243900000099",
        schoolCode: "CD-2026-0001",
      },
      principal,
      auditMeta,
    );
    const beforeUsers = await pool.query(`SELECT COUNT(*)::int AS count FROM users`);
    const [raceA, raceB] = await Promise.all([
      store.provisionContactAccount(raceContact.id, { studentId: student.rows[0].id }, principal, auditMeta),
      store.provisionContactAccount(raceContact.id, { studentId: student.rows[0].id }, principal, auditMeta),
    ]);
    const afterUsers = await pool.query(`SELECT COUNT(*)::int AS count FROM users`);
    assert.equal(afterUsers.rows[0].count - beforeUsers.rows[0].count, 1, "un seul utilisateur créé en concurrence");
    assert.equal([raceA, raceB].filter((row) => row.created).length, 1, "une seule branche created=true");
    assert.equal(raceA.user.id, raceB.user.id, "même compte parent après concurrence");

    console.log("clientsRepository.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
