"use strict";

/**
 * Intégration PostgreSQL — pédagogie canonique (cours, emplois du temps, projection).
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { createPedagogyPgStore } = require("../db/pedagogyPgStore");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { PEDAGOGY_ERROR } = require("./pedagogyManagement");
const { createTxAdapter } = require("../db/txAdapter");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const PEDAGOGY_IT_DATABASE = String(process.env.SOMAFRIK_PEDAGOGY_IT_DATABASE ?? "somafrik_pedagogy_it")
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
        const tx = createTxAdapter(client);
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
    createTxScope(tx) {
      return {
        query: (sql, params) => tx.query(sql, params),
        one: (sql, params) => tx.one(sql, params),
        all: (sql, params) => tx.all(sql, params),
      };
    },
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("pedagogyRepository.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, PEDAGOGY_IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);
    await pool.query(PEDAGOGY_SCHEMA_SQL);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'CD-2026-0001', 'Lycée A', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'BI-2026-0001', 'Lycée B', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status)
       VALUES ($1, '2025-2026', 'open') RETURNING id`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-6A', '6ème A', 'active')`,
      [schoolA.rows[0].id, year.rows[0].id],
    );

    const repo = createRepo(pool);
    const store = createPedagogyPgStore(repo);
    const admin = {
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      sub: "admin-pedagogy-it",
    };
    const auditMeta = { ipAddress: "127.0.0.1", userAgent: "pedagogy-it" };

    const course = await store.createSchoolCourse(
      {
        className: "6ème A",
        name: "Mathématiques",
        coefficient: 2,
      },
      admin,
      auditMeta,
    );
    assert.ok(course.id);
    assert.equal(course.className, "6ème A");
    assert.equal(course.name, "Mathématiques");

    await assert.rejects(
      () =>
        store.createSchoolCourse(
          { className: "6ème A", name: "Physique" },
          { role: "Admin School", schoolCode: "BI-2026-0001" },
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.TENANT_MISMATCH || error.code === PEDAGOGY_ERROR.COURSE_NOT_FOUND,
    );

    const slotA = await store.createCourseSchedule(
      {
        id: "SCH-LOT5-1",
        className: "6ème A",
        subject: "Mathématiques",
        start: "2026-09-01T08:00:00.000Z",
        end: "2026-09-01T09:00:00.000Z",
      },
      admin,
      auditMeta,
    );
    assert.equal(slotA.className, "6ème A");

    await assert.rejects(
      () =>
        store.createCourseSchedule(
          {
            id: "SCH-LOT5-CONFLICT",
            className: "6ème A",
            subject: "Mathématiques",
            start: "2026-09-01T08:30:00.000Z",
            end: "2026-09-01T09:30:00.000Z",
          },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.COURSE_SCHEDULE_CONFLICT,
    );

    const projection = await store.listProjection();
    const schoolCourses = projection.courses.filter((row) => row.schoolCode === "CD-2026-0001");
    const schoolSlots = projection.courseSchedules.filter((row) => row.schoolCode === "CD-2026-0001");
    assert.ok(schoolCourses.some((row) => row.name === "Mathématiques"));
    assert.ok(schoolSlots.some((row) => row.id === "SCH-LOT5-1"));

    const auditRows = await pool.query(
      `SELECT * FROM audit_logs WHERE action IN ('create_course', 'create_course_schedule')`,
    );
    assert.ok(auditRows.rowCount >= 2);

    console.log("pedagogyRepository.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
