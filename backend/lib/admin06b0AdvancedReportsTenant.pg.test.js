"use strict";

/**
 * ADMIN-06B0 — PG-R06B0 : deux écoles, agrégats isolés + cache HTTP/service.
 * Base IT isolée uniquement. Aucune migration.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { PostgresRepository } = require("../db/postgresRepository");
const { CacheService } = require("../services/cacheService");
const { getAdvancedReportsForPrincipal } = require("./advancedReportsScope");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_ADMIN06B0_REPORTS_IT_DATABASE ?? "somafrik_admin06b0_reports_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const FORBIDDEN_DATABASES = new Set(["", "template0", "template1"]);
const SOURCE_ALLOWLIST = new Set(["postgres", "somafrik", IT_DB]);
const URL_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);
const REMOTE_URL_MARKERS =
  /supabase|render\.com|neon\.tech|amazonaws|azure|cloudsql|preprod|production|somafrik_demo|demo\.somafrik|somafrik\.app/i;

function databaseNameFromUrl(databaseUrl) {
  return decodeURIComponent(String(new URL(databaseUrl).pathname ?? "").replace(/^\//, "")).trim();
}

function normalizeHost(host) {
  return String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
}

function isLoopbackUrlHost(host) {
  const value = normalizeHost(host);
  if (!value) return false;
  if (URL_LOOPBACK_HOSTS.has(value)) return true;
  if (value.startsWith("::ffff:") && URL_LOOPBACK_HOSTS.has(value.slice("::ffff:".length))) return true;
  return false;
}

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function isolationRefusal({ itDb, sourceDb, host, databaseUrl } = {}) {
  if (!itDb) return "IT database name empty after sanitization";
  if (FORBIDDEN_DATABASES.has(itDb)) return `IT database name forbidden (${itDb})`;
  if (itDb !== "somafrik_admin06b0_reports_it" && !/^[a-z][a-z0-9_]*_admin06b0_reports_it$/.test(itDb)) {
    return `IT database must be somafrik_admin06b0_reports_it (got ${itDb})`;
  }
  if (!sourceDb) return "DATABASE_URL database empty";
  if (FORBIDDEN_DATABASES.has(sourceDb)) return `DATABASE_URL database forbidden (${sourceDb})`;
  if (!SOURCE_ALLOWLIST.has(sourceDb)) {
    return `DATABASE_URL database ${sourceDb} is not an authorized CI/IT maintenance database`;
  }
  if (databaseUrl && REMOTE_URL_MARKERS.test(databaseUrl)) {
    return "DATABASE_URL matches a remote/demo/preprod/production marker — refusing";
  }
  if (!isLoopbackUrlHost(host)) {
    return `DATABASE_URL host is not a loopback test host (${host || "empty"})`;
  }
  return null;
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

function createReportsRepo(pool) {
  const repo = Object.create(PostgresRepository.prototype);
  repo.init = async () => {};
  repo.all = async (sql, params) => (await pool.query(sql, params)).rows;
  repo.one = async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null;
  repo.getSchoolByCode = async (code) =>
    repo.one(
      `SELECT id, school_code FROM schools WHERE upper(school_code) = upper($1) LIMIT 1`,
      [code],
    );
  return repo;
}

async function seedTenant(pool, { countryId, schoolCode, name, suffix, gradeScore, paymentAmount, examType }) {
  const school = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
    [countryId, schoolCode, name],
  );
  const schoolId = school.rows[0].id;
  const year = await pool.query(
    `INSERT INTO academic_years (school_id, name, status, is_current)
     VALUES ($1, '2025-2026', 'open', TRUE) RETURNING id`,
    [schoolId],
  );
  const term = await pool.query(
    `INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'Trimestre 1', 'open') RETURNING id`,
    [year.rows[0].id],
  );
  const klass = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [schoolId, year.rows[0].id, `CLS-${suffix}`, `Classe ${suffix}`],
  );
  const subject = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
     VALUES ($1, $2, 'Mathématiques', 2, 'active') RETURNING id`,
    [schoolId, `SUB-${suffix}`],
  );
  const teacher = await pool.query(
    `INSERT INTO teachers (school_id, teacher_code, status) VALUES ($1, $2, 'active') RETURNING id`,
    [schoolId, `ENS-${suffix}`],
  );
  const student = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [schoolId, `ELE-${suffix}`, "Élève", suffix],
  );
  await pool.query(
    `INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, grade_type, score, max_score, grade_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'devoir', $7, 20, 'graded')`,
    [schoolId, student.rows[0].id, klass.rows[0].id, subject.rows[0].id, teacher.rows[0].id, term.rows[0].id, gradeScore],
  );
  await pool.query(
    `INSERT INTO payments (school_id, student_id, payment_code, amount, currency, payment_method, payment_status)
     VALUES ($1, $2, $3, $4, 'CDF', 'cash', 'paid')`,
    [schoolId, student.rows[0].id, `PAY-${suffix}`, paymentAmount],
  );
  await pool.query(
    `INSERT INTO attendance (school_id, student_id, class_id, attendance_date, status)
     VALUES ($1, $2, $3, '2026-05-27', $4)`,
    [schoolId, student.rows[0].id, klass.rows[0].id, suffix === "A" ? "present" : "absent"],
  );
  const exam = await pool.query(
    `INSERT INTO exams (school_id, class_id, subject_id, term_id, exam_code, name, exam_type, exam_date, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '2026-06-10', 'completed') RETURNING id`,
    [schoolId, klass.rows[0].id, subject.rows[0].id, term.rows[0].id, `EXA-${suffix}`, `Examen ${suffix}`, examType],
  );
  await pool.query(
    `INSERT INTO exam_results (school_id, exam_id, student_id, score, max_score, status)
     VALUES ($1, $2, $3, $4, 20, 'published')`,
    [schoolId, exam.rows[0].id, student.rows[0].id, gradeScore],
  );
  await pool.query(
    `INSERT INTO subscriptions (school_id, plan_name, price_per_student, billing_currency, status)
     VALUES ($1, 'Premium', 10, 'USD', 'active')`,
    [schoolId],
  );
  return { schoolId, className: `Classe ${suffix}`, examType };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("admin06b0AdvancedReportsTenant.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }
  const refusal = isolationRefusal({
    itDb: IT_DB,
    sourceDb: databaseNameFromUrl(DATABASE_URL),
    host: normalizeHost(new URL(DATABASE_URL).hostname),
    databaseUrl: DATABASE_URL,
  });
  if (refusal) {
    throw new Error(`ADMIN-06B0 PG isolation refused: ${refusal}`);
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  try {
    const current = await pool.query("SELECT current_database() AS name");
    assert.equal(current.rows[0].name, IT_DB);
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const tenantA = await seedTenant(pool, {
      countryId: country.rows[0].id,
      schoolCode: "CD-2026-0001",
      name: "Lycée A",
      suffix: "A",
      gradeScore: 16,
      paymentAmount: 25000,
      examType: "Contrôle A",
    });
    const tenantB = await seedTenant(pool, {
      countryId: country.rows[0].id,
      schoolCode: "BI-2026-0002",
      name: "Lycée B",
      suffix: "B",
      gradeScore: 8,
      paymentAmount: 900,
      examType: "Examen B",
    });

    const repo = createReportsRepo(pool);
    const reportA = await repo.getAdvancedReportsV2(tenantA.schoolId);
    const reportB = await repo.getAdvancedReportsV2(tenantB.schoolId);

    assert.equal(reportA.academic[0].label, "Classe A");
    assert.equal(reportB.academic[0].label, "Classe B");
    assert.equal(Number(reportA.academic[0].average), 16);
    assert.equal(Number(reportB.academic[0].average), 8);
    assert.equal(reportA.financial.paid, 25000);
    assert.equal(reportB.financial.paid, 900);
    assert.equal(reportA.financial.payments, 1);
    assert.equal(reportB.financial.payments, 1);
    assert.equal(reportA.attendance.total, 1);
    assert.equal(reportA.attendance.rate, 100);
    assert.equal(reportB.attendance.rate, 0);
    assert.equal(reportA.exams[0].label, "Contrôle A");
    assert.equal(reportB.exams[0].label, "Examen B");
    assert.equal(reportA.exams.some((row) => row.label === "Examen B"), false);
    assert.equal(reportB.exams.some((row) => row.label === "Contrôle A"), false);
    assert.equal(reportA.global.countries, 1);
    assert.equal(reportA.global.schools, 1);
    assert.equal(reportA.global.students, 1);
    assert.equal(reportB.global.students, 1);
    assert.equal(reportA.global.teachers, 1);
    assert.equal(reportA.global.activeSubscriptions, 1);
    assert.notEqual(reportA.financial.paid, reportB.financial.paid);

    await assert.rejects(
      () => repo.getAdvancedReportsV2(),
      (error) => error.statusCode === 400,
    );

    const cache = new CacheService({ ttlMs: 60_000 });
    const principalA = { role: "Admin School", schoolCode: "CD-2026-0001", permissions: ["Rapports:READ"] };
    const principalB = { role: "Admin School", schoolCode: "BI-2026-0002", permissions: ["Rapports:READ"] };
    const cachedA = await getAdvancedReportsForPrincipal({ repository: repo, cache, principal: principalA });
    const cachedB = await getAdvancedReportsForPrincipal({ repository: repo, cache, principal: principalB });
    const cachedA2 = await getAdvancedReportsForPrincipal({ repository: repo, cache, principal: principalA });
    assert.equal(cachedA.financial.paid, 25000);
    assert.equal(cachedB.financial.paid, 900);
    assert.equal(cachedA2.financial.paid, 25000);
    assert.equal(cachedA2.financial.paid === cachedB.financial.paid, false);

    console.log("admin06b0AdvancedReportsTenant.pg.test.js PASS");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
