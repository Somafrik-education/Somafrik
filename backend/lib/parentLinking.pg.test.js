"use strict";

/**
 * Intégration PostgreSQL — liaison parent atomique.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { CLIENTS_SCHEMA_SQL } = require("../db/clientsSchema");
const { createClientsPgStore } = require("../db/clientsPgStore");
const { createTxAdapter } = require("../db/txAdapter");
const { ensureSchoolLoginCodeColumn } = require("../db/ensureSchoolLoginCodeColumn");
const { ensureParentLinkingConstraints } = require("./parentLinkingConstraints");
const { hashSecret } = require("../services/credentialService");
const { CLIENTS_ERROR } = require("./clientsManagement");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_PARENT_LINKING_IT_DATABASE ?? "somafrik_parent_linking_it")
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
    console.log("parentLinking.pg.test.js SKIP (DATABASE_URL absent)");
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
    await ensureSchoolLoginCodeColumn((sql) => pool.query(sql));
    const repo = createRepo(pool);
    await ensureParentLinkingConstraints(repo);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1, 'CD-2026-0001', 'CD-IN-26-001', 'INSTITUT NURU', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1, 'BI-2026-0002', 'BI-KG-26-002', 'KIGOBE', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const esther = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1, 'STU-ESTHER', 'Esther', 'OKITO', 'active') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const sarah = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1, 'STU-SARAH', 'Sarah', 'OKITO', 'active') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const foreignStudent = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1, 'STU-B', 'Cross', 'Tenant', 'active') RETURNING id`,
      [schoolB.rows[0].id],
    );

    const store = createClientsPgStore(repo);
    const principal = {
      sub: "actor-1",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      identifier: "admin",
    };
    const auditMeta = { ipAddress: "127.0.0.1", userAgent: "pg-test" };

    const first = await store.linkParent(
      {
        studentId: esther.rows[0].id,
        firstName: "Baudouin",
        lastName: "OKITO",
        phone: "+243811111111",
        email: "baudouin.okito@test.local",
        relationType: "parent_student",
      },
      principal,
      auditMeta,
    );
    assert.equal(first.created, true);
    const userId = first.user.id;

    const counts = async () => {
      const users = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE id = $1`, [userId]);
      const contacts = await pool.query(
        `SELECT COUNT(*)::int AS n FROM contacts WHERE user_id = $1 AND status = 'active'`,
        [userId],
      );
      const roles = await pool.query(
        `SELECT COUNT(*)::int AS n FROM user_roles WHERE user_id = $1 AND role_key = 'PARENT' AND status = 'active'`,
        [userId],
      );
      const relations = await pool.query(
        `SELECT COUNT(*)::int AS n FROM contact_relations r
         JOIN contacts c ON c.id = r.contact_id
         WHERE c.user_id = $1 AND r.status = 'active'`,
        [userId],
      );
      return {
        users: users.rows[0].n,
        contacts: contacts.rows[0].n,
        roles: roles.rows[0].n,
        relations: relations.rows[0].n,
      };
    };

    assert.deepEqual(await counts(), { users: 1, contacts: 1, roles: 1, relations: 1 });

    const second = await store.linkParent(
      {
        studentId: sarah.rows[0].id,
        phone: "+243811111111",
        email: "baudouin.okito@test.local",
      },
      principal,
      auditMeta,
    );
    assert.equal(second.user.id, userId);
    assert.equal(second.created, true);
    assert.deepEqual(await counts(), { users: 1, contacts: 1, roles: 1, relations: 2 });

    const again = await store.linkParent(
      {
        studentId: esther.rows[0].id,
        phone: "+243811111111",
        email: "baudouin.okito@test.local",
      },
      principal,
      auditMeta,
    );
    assert.equal(again.created, false);
    assert.deepEqual(await counts(), { users: 1, contacts: 1, roles: 1, relations: 2 });

    const teacherUser = await store.withTransaction(async (tx) => {
      const user = await tx.insertUser({
        schoolId: schoolA.rows[0].id,
        userCode: "USR-TEACH-PG",
        firstName: "Paul",
        lastName: "Enseignant",
        email: "paul.teacher.pg@test.local",
        phone: "+243833333333",
        role: "TEACHER",
        status: "active",
        passwordHash: hashSecret("TeacherPin1!"),
        profile: {},
      });
      await tx.insertUserRole({
        userId: user.id,
        schoolId: schoolA.rows[0].id,
        roleKey: "TEACHER",
      });
      return user;
    });
    const teacherLink = await store.linkParent(
      {
        studentId: esther.rows[0].id,
        phone: "+243833333333",
        email: "paul.teacher.pg@test.local",
      },
      principal,
      auditMeta,
    );
    assert.equal(teacherLink.user.id, teacherUser.id);
    const keys = await store.bind({}).listActiveUserRoleKeys(teacherUser.id);
    assert.ok(keys.includes("TEACHER"));
    assert.ok(keys.includes("PARENT"));

    await assert.rejects(
      () =>
        store.linkParent(
          { studentId: foreignStudent.rows[0].id, phone: "+243811111111", email: "baudouin.okito@test.local" },
          principal,
          auditMeta,
        ),
      (error) => error.statusCode === 404 && error.code === CLIENTS_ERROR.STUDENT_NOT_FOUND,
    );

    await store.withTransaction(async (tx) => {
      await tx.insertUser({
        schoolId: schoolA.rows[0].id,
        userCode: "USR-AMB-A",
        firstName: "Alice",
        lastName: "Mail",
        email: "alice.pg@test.local",
        phone: "+243844444441",
        role: "PARENT",
        status: "active",
        passwordHash: hashSecret("x"),
        profile: {},
      });
      await tx.insertUser({
        schoolId: schoolA.rows[0].id,
        userCode: "USR-AMB-B",
        firstName: "Bob",
        lastName: "Phone",
        email: "bob.pg@test.local",
        phone: "+243855555551",
        role: "PARENT",
        status: "active",
        passwordHash: hashSecret("x"),
        profile: {},
      });
    });
    await assert.rejects(
      () =>
        store.linkParent(
          {
            studentId: sarah.rows[0].id,
            email: "alice.pg@test.local",
            phone: "+243855555551",
            firstName: "X",
            lastName: "Y",
          },
          principal,
          auditMeta,
        ),
      (error) => error.statusCode === 409 && error.code === CLIENTS_ERROR.PARENT_IDENTITY_AMBIGUOUS,
    );

    const race = await Promise.all([
      store.linkParent(
        {
          studentId: sarah.rows[0].id,
          firstName: "Race",
          lastName: "Parent",
          phone: "+243877777777",
          email: "race.parent@test.local",
        },
        principal,
        auditMeta,
      ),
      store.linkParent(
        {
          studentId: sarah.rows[0].id,
          firstName: "Race",
          lastName: "Parent",
          phone: "+243877777777",
          email: "race.parent@test.local",
        },
        principal,
        auditMeta,
      ),
    ]);
    assert.equal(race.filter((row) => row.created).length, 1);
    const raceUsers = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE email = 'race.parent@test.local'`);
    assert.equal(raceUsers.rows[0].n, 1);

    const originalWithTx = store.withTransaction.bind(store);
    store.withTransaction = async (fn) =>
      originalWithTx(async (tx) => {
        const originalInsertRelation = tx.insertRelation.bind(tx);
        tx.insertRelation = async () => {
          throw Object.assign(new Error("simulated relation failure"), { statusCode: 500 });
        };
        try {
          return await fn(tx);
        } finally {
          tx.insertRelation = originalInsertRelation;
        }
      });
    const usersBefore = await pool.query(`SELECT COUNT(*)::int AS n FROM users`);
    try {
      await assert.rejects(
        () =>
          store.linkParent(
            {
              studentId: esther.rows[0].id,
              firstName: "Rollback",
              lastName: "Pg",
              phone: "+243888888888",
              email: "rollback.pg@test.local",
            },
            principal,
            auditMeta,
          ),
        (error) => error.message.includes("simulated") || error.statusCode === 500,
      );
    } finally {
      store.withTransaction = originalWithTx;
    }
    const usersAfter = await pool.query(`SELECT COUNT(*)::int AS n FROM users`);
    assert.equal(usersAfter.rows[0].n, usersBefore.rows[0].n);
    const leaked = await pool.query(`SELECT 1 FROM users WHERE email = 'rollback.pg@test.local'`);
    assert.equal(leaked.rowCount, 0);

    const alias = await store.createRelation(
      { fromContactId: first.contact.id, toStudentId: sarah.rows[0].id },
      principal,
      auditMeta,
    );
    assert.equal(alias.created, false);

    console.log("parentLinking.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
