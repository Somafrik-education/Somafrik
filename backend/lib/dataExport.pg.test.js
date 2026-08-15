"use strict";

/**
 * LOT 6 P1 — snapshot export REPEATABLE READ.
 * Une mutation concurrente (transfert d'élève) ne doit jamais mélanger
 * l'instant « avant » et l'instant « après » dans le même fichier.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { PostgresRepository } = require("../db/postgresRepository");
const { exportSchoolData } = require("./dataExportService");
const { DATA_EXPORT_SNAPSHOT_ISOLATION } = require("./dataExportManagement");

const ROOT = path.resolve(__dirname, "../..");
const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_DATA_EXPORT_SNAPSHOT_IT_DATABASE ?? "somafrik_data_export_snapshot_it")
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

function createSnapshotRepo(pool) {
  const repo = Object.create(PostgresRepository.prototype);
  repo.pool = pool;
  repo.ready = true;
  repo.query = PostgresRepository.prototype.query;
  repo.one = PostgresRepository.prototype.one;
  repo.all = PostgresRepository.prototype.all;
  repo.createTxScope = PostgresRepository.prototype.createTxScope;
  repo.withReadOnlyRepeatableRead = PostgresRepository.prototype.withReadOnlyRepeatableRead;
  repo.recordAudit = async (entry) => {
    await pool.query(
      `INSERT INTO audit_logs (action, entity_type, entity_id, new_value)
       VALUES ($1, $2, $3, $4)`,
      [entry.action, entry.entityType, entry.entityId ?? null, JSON.stringify(entry.newValue ?? {})],
    );
  };
  return repo;
}

async function main() {
  if (!DATABASE_URL) {
    console.log("dataExport.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  assert.equal(DATA_EXPORT_SNAPSHOT_ISOLATION, "REPEATABLE READ");

  const isolatedUrl = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(ROOT, "backend/db/schema.sql"), "utf8"));

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const school = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'CD-2026-0001', 'Lycée Snapshot', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status, is_current)
       VALUES ($1, '2025-2026', 'open', TRUE) RETURNING id`,
      [school.rows[0].id],
    );
    await pool.query(
      `INSERT INTO school_settings (school_id, period_mode, default_scale, report_card_mode)
       VALUES ($1, 'trimestre', 20, 'period')
       ON CONFLICT (school_id) DO NOTHING`,
      [school.rows[0].id],
    );
    const classOld = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-OLD', '6ème A', 'active') RETURNING id`,
      [school.rows[0].id, year.rows[0].id],
    );
    const classNew = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-NEW', '6ème B', 'active') RETURNING id`,
      [school.rows[0].id, year.rows[0].id],
    );
    const student = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1, 'STU-SNAP-1', 'Amina', 'Snapshot', 'active') RETURNING id`,
      [school.rows[0].id],
    );
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [school.rows[0].id, student.rows[0].id, classOld.rows[0].id, year.rows[0].id],
    );

    const repo = createSnapshotRepo(pool);
    const principal = {
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      permissions: ["Paramètres Établissement:READ"],
      sub: "admin-snap",
    };

    let isolation = null;
    let readOnly = null;
    let mutatedDuringExport = false;

    const envelope = await exportSchoolData(repo, principal, "CD-2026-0001", {}, {
      onBarrier: async (name, executor) => {
        if (name !== "students") return;
        const iso = await executor.one("SHOW transaction_isolation");
        isolation = String(iso.transaction_isolation).toLowerCase();
        const mode = await executor.one("SHOW transaction_read_only");
        readOnly = String(mode.transaction_read_only).toLowerCase();
        await pool.query(
          `UPDATE enrollments SET class_id = $1, updated_at = NOW()
           WHERE student_id = $2 AND status = 'active'`,
          [classNew.rows[0].id, student.rows[0].id],
        );
        mutatedDuringExport = true;
      },
    });

    assert.equal(mutatedDuringExport, true, "la mutation concurrente doit avoir lieu pendant l'export");
    assert.equal(isolation, "repeatable read");
    assert.equal(readOnly, "on");

    const exportedStudent = (envelope.domains.students ?? []).find((row) => row.studentCode === "STU-SNAP-1");
    const exportedOld = (envelope.domains.classes ?? []).find((row) => row.classCode === "CLS-OLD");
    const exportedNew = (envelope.domains.classes ?? []).find((row) => row.classCode === "CLS-NEW");
    assert.ok(exportedStudent, "élève manquant dans l'export");
    assert.ok(exportedOld && exportedNew, "classes manquantes dans l'export");

    assert.equal(
      exportedStudent.classCode,
      "CLS-OLD",
      "l'élève doit rester sur la classe du snapshot (avant transfert)",
    );
    assert.equal(
      exportedOld.students,
      1,
      "CLS-OLD doit encore compter l'élève (même instant que students)",
    );
    assert.equal(
      exportedNew.students,
      0,
      "CLS-NEW ne doit pas déjà compter l'élève (mélange ancien/nouveau interdit)",
    );

    const live = await pool.query(
      `SELECT cl.class_code
       FROM enrollments e
       JOIN classes cl ON cl.id = e.class_id
       WHERE e.student_id = $1 AND e.status = 'active'`,
      [student.rows[0].id],
    );
    assert.equal(live.rows[0].class_code, "CLS-NEW", "la mutation concurrente doit être commitée hors snapshot");

    const audit = await pool.query(
      `SELECT action, new_value FROM audit_logs WHERE action = 'export_school_data' ORDER BY created_at DESC LIMIT 1`,
    );
    assert.ok(audit.rowCount > 0, "audit export_school_data manquant");
    const auditText = JSON.stringify(audit.rows[0].new_value);
    assert.equal(auditText.includes("Amina"), false);
    assert.equal(auditText.includes("password"), false);

    console.log("dataExport.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
