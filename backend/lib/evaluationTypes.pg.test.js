"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");
const { createTxAdapter } = require("../db/txAdapter");
const {
  EVALUATION_TYPES_SCHEMA_SQL,
  assertEvaluationTypesSchemaPreflight,
} = require("../db/evaluationTypesSchema");
const { createEvaluationTypesPgStore } = require("../db/evaluationTypesPgStore");
const {
  createEvaluationType,
  updateEvaluationType,
  archiveEvaluationType,
  resolveEvaluationTypeForWrite,
  ensureEvaluationTypesConstraints,
  stripLegacyEvaluationTypesPayloads,
  ensureEvaluationTypesBootstrap,
} = require("./evaluationTypesService");
const { EVALUATION_TYPES_ERROR, assertNoLegacyEvaluationTypesWrite, DEFAULT_EVALUATION_TYPES } = require("./evaluationTypesManagement");
const { createResidualPgStore } = require("../db/residualPgStore");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_EVALUATION_TYPES_IT_DATABASE ?? "somafrik_evaluation_types_it")
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
    getSchoolByCode: async (code) =>
      repo.one(
        `SELECT s.id, s.school_code, s.country_id
         FROM schools s
         WHERE upper(s.school_code) = upper($1)`,
        [code],
      ),
    getEvaluationTypesStore: () => createEvaluationTypesPgStore(repo),
    listEvaluationTypeNames: (schoolCode) => createEvaluationTypesPgStore(repo).listActiveNames(schoolCode),
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
      scoped.getEvaluationTypesStore = () => createEvaluationTypesPgStore(scoped);
      scoped.listEvaluationTypeNames = (schoolCode) => createEvaluationTypesPgStore(scoped).listActiveNames(schoolCode);
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
    createEvaluationType: (payload, principal, auditMeta, schoolCode) =>
      createEvaluationType(repo, payload, principal, auditMeta, schoolCode),
    updateEvaluationType: (typeId, patch, principal, auditMeta, schoolCode) =>
      updateEvaluationType(repo, typeId, patch, principal, auditMeta, schoolCode),
    archiveEvaluationType: (typeId, principal, auditMeta, schoolCode) =>
      archiveEvaluationType(repo, typeId, principal, auditMeta, schoolCode),
    getResidualStore: () => createResidualPgStore(repo),
    saveAcademicConfig: (schoolCode, config, tx) => createResidualPgStore(repo).saveAcademicConfig(schoolCode, config, tx),
    getAcademicConfig: (schoolCode) => createResidualPgStore(repo).getAcademicConfig(schoolCode),
  };
  return repo;
}

async function seedSchools(pool) {
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
     VALUES ($1, 'BI-2026-0002', 'Lycée B', 'active') RETURNING id`,
    [country.rows[0].id],
  );
  return {
    schoolAId: schoolA.rows[0].id,
    schoolBId: schoolB.rows[0].id,
    schoolACode: "CD-2026-0001",
    schoolBCode: "BI-2026-0002",
  };
}

async function resetBaseSchema(pool) {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
  await ensureClientsCanonicalBootstrap(pool, { info() {}, error() {} });
  await pool.query(fs.readFileSync(path.join(__dirname, "../db/migrations/20260814_residual_state_canonical.sql"), "utf8"));
}

async function testLegacyBootstrapInventory(pool) {
  await resetBaseSchema(pool);
  const { schoolAId } = await seedSchools(pool);
  await pool.query(
    `INSERT INTO school_academic_configs (school_id, config_payload, updated_at)
     VALUES ($1, $2::jsonb, NOW())`,
    [schoolAId, JSON.stringify({ evaluationTypes: ["Devoir", "Quiz maison"], periods: [] })],
  );
  const repo = createRepo(pool);
  await assertEvaluationTypesSchemaPreflight(repo);
  await assert.rejects(
    () => ensureEvaluationTypesConstraints(repo, console),
    (error) => error.code === EVALUATION_TYPES_ERROR.LEGACY_EVALUATION_TYPES_AMBIGUOUS,
  );
  const row = await pool.query(`SELECT config_payload FROM school_academic_configs WHERE school_id = $1`, [schoolAId]);
  assert.deepEqual(row.rows[0].config_payload.evaluationTypes, ["Devoir", "Quiz maison"]);
}

async function testStripAfterCleanInventory(pool) {
  await resetBaseSchema(pool);
  const { schoolAId } = await seedSchools(pool);
  await pool.query(
    `INSERT INTO school_academic_configs (school_id, config_payload, updated_at)
     VALUES ($1, $2::jsonb, NOW())`,
    [schoolAId, JSON.stringify({ evaluationTypes: DEFAULT_EVALUATION_TYPES.map((row) => row.name), periods: [] })],
  );
  const repo = createRepo(pool);
  await assertEvaluationTypesSchemaPreflight(repo);
  await ensureEvaluationTypesConstraints(repo, console);
  await pool.query(EVALUATION_TYPES_SCHEMA_SQL);
  await stripLegacyEvaluationTypesPayloads(repo);
  const row = await pool.query(`SELECT config_payload FROM school_academic_configs WHERE school_id = $1`, [schoolAId]);
  assert.equal("evaluationTypes" in row.rows[0].config_payload, false);
  assert.ok(Array.isArray(row.rows[0].config_payload.periods));
}

async function testSubsetInventoryBlocksBoot(pool) {
  await resetBaseSchema(pool);
  const { schoolAId } = await seedSchools(pool);
  await pool.query(
    `INSERT INTO school_academic_configs (school_id, config_payload, updated_at)
     VALUES ($1, $2::jsonb, NOW())`,
    [schoolAId, JSON.stringify({ evaluationTypes: ["Devoir"], periods: [] })],
  );
  const repo = createRepo(pool);
  await assertEvaluationTypesSchemaPreflight(repo);
  await assert.rejects(
    () => ensureEvaluationTypesConstraints(repo, console),
    (error) => error.code === EVALUATION_TYPES_ERROR.LEGACY_EVALUATION_TYPES_AMBIGUOUS,
  );
  const row = await pool.query(`SELECT config_payload FROM school_academic_configs WHERE school_id = $1`, [schoolAId]);
  assert.deepEqual(row.rows[0].config_payload.evaluationTypes, ["Devoir"]);
  assert.equal("evaluationTypes" in row.rows[0].config_payload, true, "sous-ensemble : JSON non strippé");
}

async function main() {
  if (!DATABASE_URL) {
    console.log("evaluationTypes.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  const adminA = {
    role: "Admin School",
    sub: "admin-a",
    schoolCode: "CD-2026-0001",
    permissions: ["Paramètres Établissement:UPDATE"],
  };
  const adminB = {
    role: "Admin School",
    sub: "admin-b",
    schoolCode: "BI-2026-0002",
    permissions: ["Paramètres Établissement:UPDATE"],
  };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "test" };

  try {
    await testLegacyBootstrapInventory(pool);
    await testSubsetInventoryBlocksBoot(pool);
    await testStripAfterCleanInventory(pool);

    await resetBaseSchema(pool);
    await pool.query(EVALUATION_TYPES_SCHEMA_SQL);
    const fixture = await seedSchools(pool);
    const repo = createRepo(pool);

    const created = await repo.createEvaluationType(
      { name: "Devoir", code: "devoir", schoolId: fixture.schoolBId, schoolCode: "BI-2026-0002" },
      adminA,
      auditMeta,
      "CD-2026-0001",
    );
    assert.ok(created.id);
    assert.equal(created.schoolCode, "CD-2026-0001");
    assert.equal(created.code, "devoir");

    await assert.rejects(
      () => repo.createEvaluationType({ name: "Devoir 2", code: "devoir" }, adminA, auditMeta, "CD-2026-0001"),
      (error) => error.statusCode === 409,
    );

    const sameCodeB = await repo.createEvaluationType(
      { name: "Devoir", code: "devoir" },
      adminB,
      auditMeta,
      "BI-2026-0002",
    );
    assert.ok(sameCodeB.id);
    assert.notEqual(sameCodeB.id, created.id);

    const listA = await repo.getEvaluationTypesStore().listBySchool("CD-2026-0001");
    const listB = await repo.getEvaluationTypesStore().listBySchool("BI-2026-0002");
    assert.equal(listA.some((row) => row.id === sameCodeB.id), false);
    assert.equal(listB.some((row) => row.id === created.id), false);

    const renamed = await repo.updateEvaluationType(
      created.id,
      { name: "Devoir écrit", displayOrder: 5 },
      adminA,
      auditMeta,
      "CD-2026-0001",
    );
    assert.equal(renamed.name, "Devoir écrit");
    assert.equal(renamed.displayOrder, 5);

    const interrogation = await repo.createEvaluationType(
      { name: "Interrogation", code: "interrogation" },
      adminA,
      auditMeta,
      "CD-2026-0001",
    );

    await repo.archiveEvaluationType(created.id, adminA, auditMeta, "CD-2026-0001");
    const archived = await repo.getEvaluationTypesStore().getById(created.id);
    assert.equal(archived.status, "archived");

    await assert.rejects(
      () =>
        resolveEvaluationTypeForWrite(repo, fixture.schoolAId, { evaluationTypeId: created.id }, { required: true }),
      (error) => error.statusCode === 409 && error.code === EVALUATION_TYPES_ERROR.TYPE_ARCHIVED,
    );

    await assert.rejects(
      () =>
        resolveEvaluationTypeForWrite(repo, fixture.schoolAId, { evaluationTypeId: "00000000-0000-4000-8000-000000000099" }, { required: true }),
      (error) => error.statusCode === 404,
    );

    await assert.rejects(
      () =>
        resolveEvaluationTypeForWrite(repo, fixture.schoolAId, { evaluationTypeId: sameCodeB.id }, { required: true }),
      (error) => error.statusCode === 404,
    );

    await assert.rejects(
      () =>
        resolveEvaluationTypeForWrite(repo, fixture.schoolAId, { evaluationType: "Type inventé" }, { required: true }),
      (error) => error.statusCode === 404,
    );

    await assert.rejects(
      () =>
        resolveEvaluationTypeForWrite(repo, fixture.schoolAId, { title: "Sans type" }, { required: true }),
      (error) => error.statusCode === 400 && error.code === EVALUATION_TYPES_ERROR.EVALUATION_TYPE_REQUIRED,
    );

    const usable = await resolveEvaluationTypeForWrite(
      repo,
      fixture.schoolAId,
      { evaluationTypeId: interrogation.id, schoolId: fixture.schoolBId },
      { required: true },
    );
    assert.equal(usable.id, interrogation.id);
    assert.equal(usable.schoolCode, "CD-2026-0001");

    await assert.rejects(
      () => repo.saveAcademicConfig("CD-2026-0001", { evaluationTypes: ["legacy"] }),
      (error) => error.code === "LEGACY_EVALUATION_TYPES_WRITE_FORBIDDEN",
    );
    assert.throws(() => assertNoLegacyEvaluationTypesWrite({ evaluationTypes: null }));

    const failPrincipal = { ...adminA };
    const failRepo = createRepo(pool);
    const originalCreateTxScope = failRepo.createTxScope.bind(failRepo);
    failRepo.createTxScope = (tx) => {
      const scope = originalCreateTxScope(tx);
      return {
        ...scope,
        getEvaluationTypesStore: () => createEvaluationTypesPgStore({
          ...scope,
          recordAudit: async () => {
            throw new Error("audit failed");
          },
        }),
        recordAudit: async () => {
          throw new Error("audit failed");
        },
      };
    };
    const beforeCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM evaluation_types WHERE school_id = $1`,
      [fixture.schoolAId],
    );
    await assert.rejects(
      () => failRepo.createEvaluationType({ name: "Oral", code: "oral" }, failPrincipal, auditMeta, "CD-2026-0001"),
      (error) => /audit failed/.test(String(error.message)),
    );
    const afterCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM evaluation_types WHERE school_id = $1`,
      [fixture.schoolAId],
    );
    assert.equal(afterCount.rows[0].count, beforeCount.rows[0].count, "rollback total si audit échoue");

    await ensureEvaluationTypesBootstrap(repo);
    const bootstrappedB = await repo.getEvaluationTypesStore().listBySchool("BI-2026-0002");
    assert.ok(bootstrappedB.length >= 1);

    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2025-2026', 'open') RETURNING id`,
      [fixture.schoolAId],
    );
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
      `INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'Trimestre 1', 'open') RETURNING id`,
      [year.rows[0].id],
    );
    const evaluation = await pool.query(
      `INSERT INTO evaluations (
         school_id, class_id, subject_id, term_id, title, evaluation_type, evaluation_type_id,
         max_score, coefficient, status, active
       ) VALUES ($1,$2,$3,$4,'Devoir 1','devoir',$5,20,1,'draft',true)
       RETURNING id, evaluation_type_id`,
      [fixture.schoolAId, klass.rows[0].id, subject.rows[0].id, term.rows[0].id, interrogation.id],
    );
    assert.equal(evaluation.rows[0].evaluation_type_id, interrogation.id);

    const fk = await pool.query(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'evaluations'::regclass AND contype = 'f'
         AND pg_get_constraintdef(oid) ILIKE '%evaluation_type_id%'`,
    );
    assert.ok(fk.rowCount >= 1, "FK evaluation_type_id présente");

    console.log("evaluationTypes.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
