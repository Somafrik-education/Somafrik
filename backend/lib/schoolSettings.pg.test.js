"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");
const { createTxAdapter } = require("../db/txAdapter");
const { EDUCATION_REFERENCE_SCHEMA_SQL } = require("../db/educationReferenceSchema");
const { ESTABLISHMENT_ROLES_SCHEMA_SQL } = require("../db/establishmentRolesSchema");
const { SCHOOL_SETTINGS_SCHEMA_SQL, assertSchoolSettingsSchemaPreflight } = require("../db/schoolSettingsSchema");
const { createSchoolSettingsPgStore } = require("../db/schoolSettingsPgStore");
const { createResidualPgStore } = require("../db/residualPgStore");
const {
  ensureSchoolSettingsConstraints,
  ensureSchoolSettingsBootstrap,
  runSchoolSettingsCanonicalBoot,
  getSchoolSettings,
  patchSchoolSettings,
  replaceAcademicPeriods,
} = require("./schoolSettingsService");
const { SCHOOL_SETTINGS_ERROR } = require("./schoolSettingsManagement");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_SCHOOL_SETTINGS_IT_DATABASE ?? "somafrik_school_settings_it")
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
  const repo = {
    query: (sql, params) => pool.query(sql, params),
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await pool.query(sql, params)).rows,
    formatDate(value) {
      if (!value) return "";
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      return `${day}-${month}-${date.getFullYear()}`;
    },
    getSchoolByCode: async (code) =>
      repo.one(
        `SELECT s.id, s.school_code, s.country_id
         FROM schools s
         WHERE upper(s.school_code) = upper($1)`,
        [code],
      ),
    async ensureCurrentAcademicYearForSchool(schoolId) {
      return repo.one(
        `SELECT *
         FROM academic_years
         WHERE school_id = $1 AND status IN ('active', 'open')
         ORDER BY is_current DESC, created_at DESC
         LIMIT 1`,
        [schoolId],
      );
    },
    getSchoolSettingsStore() {
      return createSchoolSettingsPgStore(repo);
    },
    getResidualStore() {
      return createResidualPgStore(repo);
    },
    saveAcademicConfig(schoolCode, config, tx) {
      return createResidualPgStore(repo).saveAcademicConfig(schoolCode, config, tx);
    },
    getAcademicConfig(schoolCode) {
      return createResidualPgStore(repo).getAcademicConfig(schoolCode);
    },
    createTxScope(tx) {
      if (!tx) return repo;
      const scoped = {
        ...repo,
        query: (sql, params) => tx.query(sql, params),
        one: async (sql, params) => (await tx.query(sql, params)).rows[0] ?? null,
        all: async (sql, params) => (await tx.query(sql, params)).rows,
        recordAudit: async (payload) => {
          if (payload.newValue?.__failAudit || payload.__failAudit) {
            throw new Error("audit failed");
          }
          await tx.query(
            `INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, old_value, new_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              null,
              null,
              payload.action,
              payload.entityType,
              payload.entityId,
              payload.oldValue ? JSON.stringify(payload.oldValue) : null,
              payload.newValue ? JSON.stringify(payload.newValue) : null,
            ],
          );
        },
      };
      scoped.getSchoolSettingsStore = () => createSchoolSettingsPgStore(scoped);
      scoped.getResidualStore = () => createResidualPgStore(scoped);
      scoped.ensureCurrentAcademicYearForSchool = (schoolId) => repo.ensureCurrentAcademicYearForSchool.call(scoped, schoolId);
      return scoped;
    },
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
    getSchoolSettings: (principal, schoolCode) => getSchoolSettings(repo, principal, schoolCode),
    patchSchoolSettings: (payload, principal, auditMeta, schoolCode) =>
      patchSchoolSettings(repo, payload, principal, auditMeta, schoolCode),
    replaceAcademicPeriods: (payload, principal, auditMeta, schoolCode) =>
      replaceAcademicPeriods(repo, payload, principal, auditMeta, schoolCode),
  };
  return repo;
}

async function seedSchools(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  const schoolA = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, name, status)
     VALUES ($1, 'CD-2026-0001', 'CD-IN-26-001', 'Lycée A', 'active') RETURNING id, login_code`,
    [country.rows[0].id],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, name, status)
     VALUES ($1, 'BI-2026-0002', 'BI-ESB-26-001', 'Lycée B', 'active') RETURNING id, login_code`,
    [country.rows[0].id],
  );
  return {
    schoolAId: schoolA.rows[0].id,
    schoolBId: schoolB.rows[0].id,
    schoolACode: String(schoolA.rows[0].login_code).trim().toUpperCase(),
    schoolBCode: String(schoolB.rows[0].login_code).trim().toUpperCase(),
  };
}

async function resetBaseSchema(pool) {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
  await ensureClientsCanonicalBootstrap(pool, { info() {}, error() {} });
  await pool.query(EDUCATION_REFERENCE_SCHEMA_SQL);
  await pool.query(ESTABLISHMENT_ROLES_SCHEMA_SQL);
  await pool.query(fs.readFileSync(path.join(__dirname, "../db/migrations/20260814_residual_state_canonical.sql"), "utf8"));
}

async function testLegacyBootstrapInventory(pool) {
  await resetBaseSchema(pool);
  const { schoolAId } = await seedSchools(pool);
  await pool.query(
    `INSERT INTO school_academic_configs (school_id, config_payload, updated_at)
     VALUES ($1, $2::jsonb, NOW())`,
    [schoolAId, JSON.stringify({ periods: [{ name: "Période Alpha", startDate: "01-09-2024", endDate: "31-12-2024" }] })],
  );
  const repo = createRepo(pool);
  await assertSchoolSettingsSchemaPreflight(repo);
  await assert.rejects(
    () => ensureSchoolSettingsConstraints(repo, console),
    (error) => error.code === SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_AMBIGUOUS,
  );
  const row = await pool.query(`SELECT config_payload FROM school_academic_configs WHERE school_id = $1`, [schoolAId]);
  assert.equal(row.rows[0].config_payload.periods[0].name, "Période Alpha");
}

async function testLegacyValidatedScalarsSurviveFullBootSequence(pool) {
  await resetBaseSchema(pool);
  const { schoolAId } = await seedSchools(pool);
  await pool.query(
    `INSERT INTO school_academic_configs (school_id, config_payload, updated_at)
     VALUES ($1, $2::jsonb, NOW())`,
    [
      schoolAId,
      JSON.stringify({ periodMode: "semestre", defaultScale: 10, reportCardMode: "annual" }),
    ],
  );
  const repo = createRepo(pool);
  const { captured } = await runSchoolSettingsCanonicalBoot(repo, console);
  assert.equal(captured.length >= 1, true);
  assert.equal(captured.find((item) => item.schoolId === schoolAId)?.periodMode, "semestre");
  assert.equal(captured.find((item) => item.schoolId === schoolAId)?.defaultScale, 10);
  assert.equal(captured.find((item) => item.schoolId === schoolAId)?.reportCardMode, "annual");

  const settings = await pool.query(
    `SELECT period_mode, default_scale, report_card_mode FROM school_settings WHERE school_id = $1`,
    [schoolAId],
  );
  assert.equal(settings.rowCount, 1);
  assert.equal(settings.rows[0].period_mode, "semestre");
  assert.equal(Number(settings.rows[0].default_scale), 10);
  assert.equal(settings.rows[0].report_card_mode, "annual");

  const json = await pool.query(`SELECT config_payload FROM school_academic_configs WHERE school_id = $1`, [schoolAId]);
  assert.equal("periodMode" in json.rows[0].config_payload, false);
  assert.equal("defaultScale" in json.rows[0].config_payload, false);
  assert.equal("reportCardMode" in json.rows[0].config_payload, false);
}

async function testSchoolInsertCreatesSettingsRow(pool) {
  await resetBaseSchema(pool);
  await pool.query(SCHOOL_SETTINGS_SCHEMA_SQL);
  const fixture = await seedSchools(pool);
  const existing = await pool.query(`SELECT period_mode FROM school_settings WHERE school_id = $1`, [fixture.schoolAId]);
  assert.equal(existing.rowCount, 1, "trigger/backfill crée school_settings à l'INSERT schools");
  assert.equal(existing.rows[0].period_mode, "trimestre");

  const country = await pool.query(`SELECT id FROM countries LIMIT 1`);
  const created = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'CD-2026-0099', 'Lycée post-boot', 'active') RETURNING id`,
    [country.rows[0].id],
  );
  const row = await pool.query(
    `SELECT period_mode, default_scale, report_card_mode FROM school_settings WHERE school_id = $1`,
    [created.rows[0].id],
  );
  assert.equal(row.rowCount, 1);
  assert.equal(row.rows[0].period_mode, "trimestre");
  assert.equal(Number(row.rows[0].default_scale), 20);
  assert.equal(row.rows[0].report_card_mode, "period");
}

async function testGetMaterializesMissingSettingsRow(pool) {
  await resetBaseSchema(pool);
  await pool.query(SCHOOL_SETTINGS_SCHEMA_SQL);
  const fixture = await seedSchools(pool);
  const repo = createRepo(pool);
  await pool.query(`DELETE FROM school_settings WHERE school_id = $1`, [fixture.schoolAId]);
  const missing = await pool.query(`SELECT 1 FROM school_settings WHERE school_id = $1`, [fixture.schoolAId]);
  assert.equal(missing.rowCount, 0);
  const adminA = {
    role: "Admin School",
    sub: "admin-a",
    schoolCode: "CD-IN-26-001",
    permissions: ["Paramètres Établissement:UPDATE"],
  };
  const settings = await repo.getSchoolSettings(adminA, "CD-IN-26-001");
  assert.equal(settings.periodMode, "trimestre");
  assert.equal(settings.defaultScale, 20);
  assert.equal(settings.reportCardMode, "period");
  const restored = await pool.query(`SELECT period_mode FROM school_settings WHERE school_id = $1`, [fixture.schoolAId]);
  assert.equal(restored.rowCount, 1, "GET matérialise school_settings en PostgreSQL");
}

async function testCustomClassNamesBlockBoot(pool) {
  await resetBaseSchema(pool);
  const { schoolAId } = await seedSchools(pool);
  await pool.query(
    `INSERT INTO school_academic_configs (school_id, config_payload, updated_at)
     VALUES ($1, $2::jsonb, NOW())`,
    [schoolAId, JSON.stringify({ classNames: ["Classe inventée"] })],
  );
  const repo = createRepo(pool);
  await assertSchoolSettingsSchemaPreflight(repo);
  await assert.rejects(
    () => ensureSchoolSettingsConstraints(repo, console),
    (error) => error.code === SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_AMBIGUOUS,
  );
  const row = await pool.query(`SELECT config_payload FROM school_academic_configs WHERE school_id = $1`, [schoolAId]);
  assert.deepEqual(row.rows[0].config_payload.classNames, ["Classe inventée"]);
}

async function main() {
  if (!DATABASE_URL) {
    console.log("schoolSettings.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  const adminA = {
    role: "Admin School",
    sub: "admin-a",
    schoolCode: "CD-IN-26-001",
    permissions: ["Paramètres Établissement:UPDATE"],
  };
  const adminB = {
    role: "Admin School",
    sub: "admin-b",
    schoolCode: "BI-ESB-26-001",
    permissions: ["Paramètres Établissement:UPDATE"],
  };
  const teacher = {
    role: "Enseignant",
    sub: "teacher-a",
    schoolCode: "CD-IN-26-001",
    permissions: ["Notes:UPDATE"],
  };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "test" };

  try {
    await testLegacyBootstrapInventory(pool);
    await testCustomClassNamesBlockBoot(pool);
    await testLegacyValidatedScalarsSurviveFullBootSequence(pool);
    await testSchoolInsertCreatesSettingsRow(pool);
    await testGetMaterializesMissingSettingsRow(pool);

    await resetBaseSchema(pool);
    await pool.query(SCHOOL_SETTINGS_SCHEMA_SQL);
    const fixture = await seedSchools(pool);
    const repo = createRepo(pool);

    await ensureSchoolSettingsConstraints(repo, console);
    await ensureSchoolSettingsBootstrap(repo, []);

    const yearsAfterBoot = await pool.query(`SELECT COUNT(*)::int AS count FROM academic_years`);
    assert.equal(yearsAfterBoot.rows[0].count, 0, "boot n'invente pas d'année scolaire");
    await pool.query(
      `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
       VALUES ($1, '2025-2026', '2025-09-01', '2026-08-31', TRUE, 'open')`,
      [fixture.schoolAId],
    );

    const created = await repo.getSchoolSettings(adminA, "CD-IN-26-001");
    assert.equal(created.schoolCode, "CD-IN-26-001");
    assert.equal(created.periodMode, "trimestre");
    assert.equal(created.defaultScale, 20);

    const patched = await repo.patchSchoolSettings(
      { periodMode: "semestre", defaultScale: 10, schoolId: fixture.schoolBId, schoolCode: "BI-ESB-26-001" },
      adminA,
      auditMeta,
      "CD-IN-26-001",
    );
    assert.equal(patched.periodMode, "semestre");
    assert.equal(patched.defaultScale, 10);
    assert.equal(patched.schoolCode, "CD-IN-26-001");

    const stillB = await repo.getSchoolSettings(adminB, "BI-ESB-26-001");
    assert.equal(stillB.periodMode, "trimestre");
    assert.equal(stillB.defaultScale, 20);

    await assert.rejects(
      () => repo.patchSchoolSettings({ periodMode: "periode" }, teacher, auditMeta, "CD-IN-26-001"),
      (error) => error.statusCode === 403,
    );

    await assert.rejects(
      () => repo.patchSchoolSettings({ defaultScale: 0 }, adminA, auditMeta, "CD-IN-26-001"),
      (error) => error.statusCode === 400,
    );

    const replaced = await repo.replaceAcademicPeriods(
      {
        periods: [
          { name: "Semestre 1", startDate: "01-09-2025", endDate: "31-01-2026" },
          { name: "Semestre 2", startDate: "01-02-2026", endDate: "30-06-2026" },
        ],
      },
      adminA,
      auditMeta,
      "CD-IN-26-001",
    );
    assert.equal(replaced.periods.length, 2);
    assert.ok(replaced.periods.some((row) => row.name === "Semestre 1"));

    const projection = await repo.getAcademicConfig("CD-IN-26-001");
    assert.equal(projection.periodMode, "semestre");
    assert.equal(projection.defaultScale, 10);
    assert.equal(projection.periods.length, 2);
    assert.ok(Array.isArray(projection.levels));
    assert.ok(Array.isArray(projection.evaluationTypes));
    assert.equal("allowCustomClasses" in projection, false);

    await assert.rejects(
      () => repo.saveAcademicConfig("CD-IN-26-001", { periodMode: "trimestre" }),
      (error) => error.code === SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_PERIODS_WRITE_FORBIDDEN,
    );
    await assert.rejects(
      () => repo.saveAcademicConfig("CD-IN-26-001", { periods: null }),
      (error) => error.code === SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_PERIODS_WRITE_FORBIDDEN,
    );
    await assert.rejects(
      () => repo.saveAcademicConfig("CD-IN-26-001", { classNames: [] }),
      (error) => error.code === SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_CLASS_NAMES_WRITE_FORBIDDEN,
    );
    await assert.rejects(
      () => repo.saveAcademicConfig("CD-IN-26-001", { defaultScale: 20 }),
      (error) => error.code === SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_WRITE_FORBIDDEN,
    );

    const emptyPut = await repo.saveAcademicConfig("CD-IN-26-001", {});
    assert.equal(emptyPut.periodMode, "semestre");
    const jsonAfterPut = await pool.query(`SELECT config_payload FROM school_academic_configs WHERE school_id = $1`, [
      fixture.schoolAId,
    ]);
    assert.deepEqual(jsonAfterPut.rows[0].config_payload, {});
    assert.equal("periods" in jsonAfterPut.rows[0].config_payload, false);

    const failRepo = createRepo(pool);
    const originalCreateTxScope = failRepo.createTxScope.bind(failRepo);
    failRepo.createTxScope = (tx) => {
      const scope = originalCreateTxScope(tx);
      return {
        ...scope,
        getSchoolSettingsStore: () => createSchoolSettingsPgStore(scope),
        recordAudit: async () => {
          throw new Error("audit failed");
        },
      };
    };
    const beforeMode = await pool.query(`SELECT period_mode FROM school_settings WHERE school_id = $1`, [
      fixture.schoolAId,
    ]);
    await assert.rejects(
      () => failRepo.patchSchoolSettings({ periodMode: "periode" }, adminA, auditMeta, "CD-IN-26-001"),
      (error) => /audit failed/.test(String(error.message)),
    );
    const afterMode = await pool.query(`SELECT period_mode FROM school_settings WHERE school_id = $1`, [
      fixture.schoolAId,
    ]);
    assert.equal(afterMode.rows[0].period_mode, beforeMode.rows[0].period_mode, "rollback total si audit échoue");

    await ensureSchoolSettingsBootstrap(repo);
    const settingsCount = await pool.query(`SELECT COUNT(*)::int AS count FROM school_settings`);
    await ensureSchoolSettingsBootstrap(repo);
    const settingsCountAgain = await pool.query(`SELECT COUNT(*)::int AS count FROM school_settings`);
    assert.equal(settingsCountAgain.rows[0].count, settingsCount.rows[0].count, "bootstrap idempotent");

    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'school_settings' ORDER BY column_name`,
    );
    const columnNames = columns.rows.map((row) => row.column_name);
    assert.ok(columnNames.includes("period_mode"));
    assert.equal(columnNames.includes("evaluation_types"), false);
    assert.equal(columnNames.includes("role_name"), false);
    const evalTable = await pool.query(`SELECT to_regclass('public.evaluation_types') AS ref`);
    assert.ok(evalTable.rows[0].ref, "LOT 3 evaluation_types non dupliqué / toujours présent");
    const rolesTable = await pool.query(`SELECT to_regclass('public.establishment_roles') AS ref`);
    assert.ok(rolesTable.rows[0].ref, "LOT 2 establishment_roles toujours présent");
    const levelsTable = await pool.query(`SELECT to_regclass('public.education_levels') AS ref`);
    assert.ok(levelsTable.rows[0].ref, "LOT 1 education_levels toujours présent");

    const year = await pool.query(
      `SELECT id FROM academic_years WHERE school_id = $1 AND status IN ('active', 'open') LIMIT 1`,
      [fixture.schoolAId],
    );
    assert.ok(year.rowCount);
    const klass = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-6A', '6ème A', 'active') RETURNING id`,
      [fixture.schoolAId, year.rows[0].id],
    );
    const subject = await pool.query(
      `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
       VALUES ($1, 'SUB-MATH', 'Mathématiques', 1, 'active') RETURNING id`,
      [fixture.schoolAId],
    );
    const term = await pool.query(
      `SELECT id, name FROM terms WHERE academic_year_id = $1 ORDER BY name LIMIT 1`,
      [year.rows[0].id],
    );
    const evaluation = await pool.query(
      `INSERT INTO evaluations (
         school_id, class_id, subject_id, term_id, title, evaluation_type,
         max_score, coefficient, status, active
       ) VALUES ($1,$2,$3,$4,'Devoir 1','devoir',20,1,'draft',true)
       RETURNING id, term_id, max_score`,
      [fixture.schoolAId, klass.rows[0].id, subject.rows[0].id, term.rows[0].id],
    );
    assert.equal(evaluation.rows[0].term_id, term.rows[0].id);
    assert.equal(Number(evaluation.rows[0].max_score), 20);

    await assert.rejects(
      () =>
        repo.replaceAcademicPeriods(
          { periods: [{ name: "Période unique", startDate: "01-09-2025", endDate: "30-06-2026" }] },
          adminA,
          auditMeta,
          "CD-IN-26-001",
        ),
      (error) => error.statusCode === 409 && error.code === SCHOOL_SETTINGS_ERROR.TERM_IN_USE,
    );

    const projectedLists = await repo.getAcademicConfig("CD-IN-26-001");
    assert.deepEqual(projectedLists.classNames, ["6ème A"]);
    assert.ok(projectedLists.subjects.includes("Mathématiques"));

    console.log("schoolSettings.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
