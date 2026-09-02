"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");
const { createClientsPgStore } = require("../db/clientsPgStore");
const { createTxAdapter } = require("../db/txAdapter");
const { ensureSchoolLoginCodeColumn } = require("../db/ensureSchoolLoginCodeColumn");
const { EDUCATION_REFERENCE_SCHEMA_SQL, assertEducationReferenceSchemaPreflight } = require("../db/educationReferenceSchema");
const { createEducationReferencePgStore } = require("../db/educationReferencePgStore");
const {
  createLevel,
  createStream,
  updateStream,
  saveSchoolActivation,
  archiveLevel,
  createGroup,
  archiveGroup,
  ensureEducationReferenceConstraints,
  stripLegacyAcademicReferencePayloads,
} = require("./educationReferenceService");
const { EDUCATION_REFERENCE_ERROR } = require("./educationReferenceManagement");
const { assertNoLegacyAcademicLevelsTracksWrite } = require("./educationReferenceManagement");
const { createResidualPgStore } = require("../db/residualPgStore");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_EDUCATION_REFERENCE_IT_DATABASE ?? "somafrik_education_reference_it")
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
        `SELECT s.id, s.school_code, s.country_id, c.iso_code AS country_code
         FROM schools s JOIN countries c ON c.id = s.country_id
         WHERE upper(s.school_code) = upper($1)`,
        [code],
      ),
    getEducationReferenceStore: () => createEducationReferencePgStore(repo),
    getSchoolEducationActiveLists: (schoolCode) => createEducationReferencePgStore(repo).getSchoolActiveLists(schoolCode),
    createTxScope(tx) {
      if (!tx) return repo;
      return {
        ...repo,
        query: (sql, params) => tx.query(sql, params),
        one: async (sql, params) => (await tx.query(sql, params)).rows[0] ?? null,
        all: async (sql, params) => (await tx.query(sql, params)).rows,
        getEducationReferenceStore: () => createEducationReferencePgStore(this),
        recordAudit: async (payload) => {
          if (payload.__failAudit) {
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
              payload.newValue ? JSON.stringify(payload.newValue) : null,
              payload.oldValue ? JSON.stringify(payload.oldValue) : null,
            ],
          );
        },
      };
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
    createEducationLevel: (payload, principal, auditMeta) => createLevel(repo, payload, principal, auditMeta),
    createEducationStream: (payload, principal, auditMeta) => createStream(repo, payload, principal, auditMeta),
    updateEducationStream: (streamId, patch, principal, auditMeta) => updateStream(repo, streamId, patch, principal, auditMeta),
    createEducationClassGroup: (payload, principal, auditMeta) => createGroup(repo, payload, principal, auditMeta),
    archiveEducationClassGroup: (groupId, principal, auditMeta) => archiveGroup(repo, groupId, principal, auditMeta),
    saveSchoolEducationActivation: (schoolCode, activation, principal, auditMeta) =>
      saveSchoolActivation(repo, schoolCode, activation, principal, auditMeta),
    archiveEducationLevel: (levelId, principal, auditMeta) => archiveLevel(repo, levelId, principal, auditMeta),
    getResidualStore: () => createResidualPgStore(repo),
    saveAcademicConfig: (schoolCode, config, tx) => createResidualPgStore(repo).saveAcademicConfig(schoolCode, config, tx),
  };
  return repo;
}

async function seedSchool(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  const fr = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('France', 'FR', '+33', 'EUR') RETURNING id`,
  );
  const school = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'CD-2026-0001', 'Test', 'active') RETURNING id`,
    [country.rows[0].id],
  );
  return { schoolId: school.rows[0].id, schoolCode: "CD-2026-0001", frCountryId: fr.rows[0].id };
}

async function resetBaseSchema(pool) {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
  await ensureClientsCanonicalBootstrap(pool, { info() {}, error() {} });
  await ensureSchoolLoginCodeColumn((sql) => pool.query(sql));
  await pool.query(fs.readFileSync(path.join(__dirname, "../db/migrations/20260814_residual_state_canonical.sql"), "utf8"));
}

async function testLegacyBootstrapInventory(pool) {
  await resetBaseSchema(pool);
  const { schoolId } = await seedSchool(pool);
  await pool.query(
    `INSERT INTO school_academic_configs (school_id, config_payload, updated_at)
     VALUES ($1, $2::jsonb, NOW())`,
    [
      schoolId,
      JSON.stringify({
        levels: ["Primaire", "Secondaire"],
        tracks: ["Scientifique"],
        periods: [],
      }),
    ],
  );

  const repo = createRepo(pool);
  await assertEducationReferenceSchemaPreflight(repo);

  await assert.rejects(
    () => ensureEducationReferenceConstraints(repo, console),
    (error) => error.code === EDUCATION_REFERENCE_ERROR.LEGACY_ACADEMIC_REFERENCE_AMBIGUOUS,
  );

  const row = await pool.query(`SELECT config_payload FROM school_academic_configs WHERE school_id = $1`, [schoolId]);
  assert.deepEqual(row.rows[0].config_payload.levels, ["Primaire", "Secondaire"]);
  assert.deepEqual(row.rows[0].config_payload.tracks, ["Scientifique"]);
}

async function testStripAfterCleanInventory(pool) {
  await resetBaseSchema(pool);
  const { schoolId } = await seedSchool(pool);
  await pool.query(
    `INSERT INTO school_academic_configs (school_id, config_payload, updated_at)
     VALUES ($1, $2::jsonb, NOW())`,
    [schoolId, JSON.stringify({ levels: [], tracks: [], periods: [] })],
  );

  const repo = createRepo(pool);
  await assertEducationReferenceSchemaPreflight(repo);
  await ensureEducationReferenceConstraints(repo, console);
  await pool.query(EDUCATION_REFERENCE_SCHEMA_SQL);
  await stripLegacyAcademicReferencePayloads(repo);

  const row = await pool.query(`SELECT config_payload FROM school_academic_configs WHERE school_id = $1`, [schoolId]);
  assert.equal("levels" in row.rows[0].config_payload, false);
  assert.equal("tracks" in row.rows[0].config_payload, false);
  assert.ok(Array.isArray(row.rows[0].config_payload.periods));
}

async function main() {
  if (!DATABASE_URL) {
    console.log("educationReference.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  const repo = createRepo(pool);
  const superPrincipal = { role: "Super Administrateur Somafrik", sub: "super-1" };
  const schoolPrincipal = {
    role: "Admin School",
    sub: "admin-1",
    schoolCode: "CD-2026-0001",
    permissions: ["Paramètres Établissement:UPDATE"],
  };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "test" };

  try {
    await testLegacyBootstrapInventory(pool);
    await testStripAfterCleanInventory(pool);

    await resetBaseSchema(pool);
    await pool.query(EDUCATION_REFERENCE_SCHEMA_SQL);

    await seedSchool(pool);

    const levelA = await repo.createEducationLevel(
      { countryCode: "CD", name: "1ère", code: "1ere" },
      superPrincipal,
      auditMeta,
    );
    const levelDup = await repo.createEducationLevel(
      { countryCode: "CD", name: "2ème", code: "2eme" },
      superPrincipal,
      auditMeta,
    );
    assert.ok(levelA.id);

    await assert.rejects(
      () => repo.createEducationLevel({ countryCode: "CD", name: "Dup", code: "1ere" }, superPrincipal, auditMeta),
      (error) => error.statusCode === 409,
    );

    const stream = await repo.createEducationStream(
      { countryCode: "CD", name: "Générale", code: "generale", streamType: "filiere", levelId: levelA.id },
      superPrincipal,
      auditMeta,
    );
    assert.ok(stream.id);

    const groupA = await repo.createEducationClassGroup(
      { countryCode: "CD", code: "A", name: "A" },
      superPrincipal,
      auditMeta,
    );
    const groupB = await repo.createEducationClassGroup(
      { countryCode: "CD", code: "B", name: "B" },
      superPrincipal,
      auditMeta,
    );
    assert.ok(groupA.id);
    assert.ok(groupB.id);
    await assert.rejects(
      () => repo.createEducationClassGroup({ countryCode: "CD", code: "A", name: "A" }, superPrincipal, auditMeta),
      (error) => error.statusCode === 409,
    );
    await assert.rejects(
      () => repo.createEducationClassGroup({ countryCode: "CD", code: "Z", name: "Z" }, schoolPrincipal, auditMeta),
      (error) => error.statusCode === 403 && error.code === EDUCATION_REFERENCE_ERROR.FORBIDDEN,
    );

    await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('Burundi', 'BI', '+257', 'BIF')
       ON CONFLICT (iso_code) DO NOTHING`,
    );
    const biCountry = await pool.query(`SELECT id FROM countries WHERE iso_code = 'BI'`);
    await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'BI-2026-0002', 'Lycée BI', 'active')
       ON CONFLICT (school_code) DO NOTHING`,
      [biCountry.rows[0].id],
    );
    const groupBi = await repo.createEducationClassGroup(
      { countryCode: "BI", code: "A", name: "A" },
      superPrincipal,
      auditMeta,
    );
    assert.ok(groupBi.id);
    assert.notEqual(groupBi.id, groupA.id);

    const frLevel = await repo.createEducationLevel(
      { countryCode: "FR", name: "Seconde", code: "seconde" },
      superPrincipal,
      auditMeta,
    );

    await assert.rejects(
      () => repo.updateEducationStream(stream.id, { levelId: frLevel.id }, superPrincipal, auditMeta),
      (error) => error.statusCode === 403 && error.code === EDUCATION_REFERENCE_ERROR.COUNTRY_MISMATCH,
    );

    const detached = await repo.updateEducationStream(stream.id, { levelId: null }, superPrincipal, auditMeta);
    assert.equal(detached.levelId, null);

    const relinked = await repo.updateEducationStream(stream.id, { levelId: levelA.id }, superPrincipal, auditMeta);
    assert.equal(relinked.levelId, levelA.id);

    const tempLevel = await repo.createEducationLevel(
      { countryCode: "CD", name: "Temp", code: "temp" },
      superPrincipal,
      auditMeta,
    );
    await repo.archiveEducationLevel(tempLevel.id, superPrincipal, auditMeta);
    await assert.rejects(
      () =>
        repo.createEducationStream(
          { countryCode: "CD", name: "Bad", code: "bad_stream", streamType: "filiere", levelId: tempLevel.id },
          superPrincipal,
          auditMeta,
        ),
      (error) => error.statusCode === 404 && error.code === EDUCATION_REFERENCE_ERROR.LEVEL_NOT_FOUND,
    );

    await assert.rejects(
      () =>
        repo.saveSchoolEducationActivation(
          "CD-2026-0001",
          { levelIds: [frLevel.id], streamIds: [] },
          schoolPrincipal,
          auditMeta,
        ),
      (error) => error.statusCode === 403 && error.code === "COUNTRY_MISMATCH",
    );

    const activation = await repo.saveSchoolEducationActivation(
      "CD-2026-0001",
      { levelIds: [levelA.id], streamIds: [stream.id], groupIds: [groupA.id, groupB.id] },
      schoolPrincipal,
      auditMeta,
    );
    assert.equal(activation.levels.find((row) => row.id === levelA.id)?.schoolActive, true);
    assert.equal(activation.groups.find((row) => row.id === groupA.id)?.schoolActive, true);
    assert.equal(activation.groups.find((row) => row.id === groupB.id)?.schoolActive, true);

    await assert.rejects(
      () =>
        repo.saveSchoolEducationActivation(
          "CD-2026-0001",
          { levelIds: [levelA.id], streamIds: [], groupIds: [groupBi.id] },
          schoolPrincipal,
          auditMeta,
        ),
      (error) => error.statusCode === 403 && error.code === "COUNTRY_MISMATCH",
    );

    const lists = await repo.getSchoolEducationActiveLists("CD-2026-0001");
    assert.deepEqual(lists.levels, ["1ère"]);
    assert.deepEqual(lists.tracks, ["Générale"]);

    await assert.rejects(
      () => repo.saveAcademicConfig("CD-2026-0001", { levels: ["legacy"] }),
      (error) => error.code === "LEGACY_ACADEMIC_LEVELS_WRITE_FORBIDDEN",
    );
    assert.throws(() => assertNoLegacyAcademicLevelsTracksWrite({ tracks: null }));

    await repo.saveSchoolEducationActivation(
      "CD-2026-0001",
      { levelIds: [levelA.id], streamIds: [stream.id], groupIds: [groupA.id] },
      schoolPrincipal,
      auditMeta,
    );
    await assert.rejects(
      () => repo.archiveEducationLevel(levelA.id, superPrincipal, auditMeta),
      (error) => error.statusCode === 409,
    );
    await assert.rejects(
      () => repo.archiveEducationClassGroup(groupA.id, superPrincipal, auditMeta),
      (error) => error.statusCode === 409 && error.code === EDUCATION_REFERENCE_ERROR.GROUP_IN_USE,
    );

    await repo.saveSchoolEducationActivation(
      "CD-2026-0001",
      { levelIds: [levelDup.id], streamIds: [stream.id], groupIds: [] },
      schoolPrincipal,
      auditMeta,
    );
    await assert.rejects(
      () => repo.archiveEducationLevel(levelA.id, superPrincipal, auditMeta),
      (error) => error.statusCode === 409 && error.code === EDUCATION_REFERENCE_ERROR.LEVEL_HAS_ACTIVE_STREAMS,
    );

    await repo.updateEducationStream(stream.id, { levelId: null }, superPrincipal, auditMeta);
    await repo.archiveEducationLevel(levelA.id, superPrincipal, auditMeta);
    const archived = await createEducationReferencePgStore(repo).getLevelById(levelA.id);
    assert.equal(archived.status, "archived");

    console.log("educationReference.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
