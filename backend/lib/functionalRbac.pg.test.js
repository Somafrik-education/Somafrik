"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { ESTABLISHMENT_ROLES_SCHEMA_SQL } = require("../db/establishmentRolesSchema");
const { FUNCTIONAL_RBAC_SCHEMA_SQL } = require("../db/functionalRbacSchema");
const { createEstablishmentRolesPgStore } = require("../db/establishmentRolesPgStore");
const { createFunctionalRbacPgStore } = require("../db/functionalRbacPgStore");
const { createTxAdapter } = require("../db/txAdapter");
const { patchConfiguredPermissions, ensureFunctionalRbacBootstrap } = require("./functionalRbacService");
const { resolveEffectivePermissionSet } = require("./functionalRbacResolution");
const { FUNCTIONAL_RBAC_ERROR } = require("./functionalRbacManagement");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_FUNCTIONAL_RBAC_IT_DATABASE ?? "somafrik_functional_rbac_it")
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

function createRepo(pool, { failAudit = false } = {}) {
  const repo = {
    query: (sql, params) => pool.query(sql, params),
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await pool.query(sql, params)).rows,
    getEstablishmentRolesStore: () => createEstablishmentRolesPgStore(repo),
    getFunctionalRbacStore: () => createFunctionalRbacPgStore(repo),
    listEstablishmentRoles: (options) => createEstablishmentRolesPgStore(repo).listRoles(options),
    createTxScope(tx) {
      if (!tx) return repo;
      const scoped = {
        ...repo,
        query: (sql, params) => tx.query(sql, params),
        one: async (sql, params) => (await tx.query(sql, params)).rows[0] ?? null,
        all: async (sql, params) => (await tx.query(sql, params)).rows,
        recordAudit: async (payload) => {
          if (failAudit) throw new Error("audit write failed");
          await tx.query(
            `INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, old_value, new_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              null,
              null,
              payload.action,
              payload.entityType,
              payload.entityId,
              JSON.stringify(payload.oldValue ?? null),
              JSON.stringify(payload.newValue ?? null),
            ],
          );
        },
      };
      scoped.getFunctionalRbacStore = () => createFunctionalRbacPgStore(scoped);
      scoped.getEstablishmentRolesStore = () => createEstablishmentRolesPgStore(scoped);
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
    recordAudit: async () => {},
  };
  return repo;
}

async function main() {
  if (!DATABASE_URL) {
    console.log("functionalRbac.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
    await pool.query(ESTABLISHMENT_ROLES_SCHEMA_SQL);
    await pool.query(FUNCTIONAL_RBAC_SCHEMA_SQL);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const countryBi = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('Burundi', 'BI', '+257', 'BIF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'CD-2026-0001', 'INSTITUT NURU', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const schoolB = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'CD-2026-0002', 'Autre école', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'BI-2026-0002', 'Lycée BI', 'active')`,
      [countryBi.rows[0].id],
    );

    const repo = createRepo(pool);
    await ensureFunctionalRbacBootstrap(repo);
    const store = createFunctionalRbacPgStore(repo);
    const superAdmin = { role: "Super Administrateur Somafrik", identifier: "superadmin" };

    await patchConfiguredPermissions(
      repo,
      {
        roleKey: "PREFET_ETUDES",
        schoolCode: "CD-2026-0001",
        grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: true, canDelete: true }],
      },
      superAdmin,
      {},
    );
    const first = await store.maxUpdatedAtForScope({
      roleKey: "PREFET_ETUDES",
      scopeType: "school",
      countryId: country.rows[0].id,
      schoolId: schoolA.rows[0].id,
    });
    await patchConfiguredPermissions(
      repo,
      {
        roleKey: "PREFET_ETUDES",
        schoolCode: "CD-2026-0001",
        expectedUpdatedAt: first,
        grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: true, canDelete: false }],
      },
      superAdmin,
      {},
    );

    const grants = await store.listGrantsForRoles(["PREFET_ETUDES"]);
    const nuru = resolveEffectivePermissionSet(["PREFET_ETUDES"], grants, {
      schoolId: schoolA.rows[0].id,
      countryId: country.rows[0].id,
    });
    const other = resolveEffectivePermissionSet(["PREFET_ETUDES"], grants, {
      schoolId: schoolB.rows[0].id,
      countryId: country.rows[0].id,
    });
    assert.equal(nuru.modules.students.canDelete, false, "école A DELETE retiré");
    assert.equal(other.modules.students.canDelete, false, "sans règle école B, fail-closed sauf global");

    const globalUpdatedAt = await store.maxUpdatedAtForScope({
      roleKey: "PREFET_ETUDES",
      scopeType: "global",
      countryId: null,
      schoolId: null,
    });
    await patchConfiguredPermissions(
      repo,
      {
        roleKey: "PREFET_ETUDES",
        scopeType: "global",
        ...(globalUpdatedAt ? { expectedUpdatedAt: globalUpdatedAt } : {}),
        grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: true, canDelete: true }],
      },
      superAdmin,
      {},
    );
    const grants2 = await store.listGrantsForRoles(["PREFET_ETUDES"]);
    const nuru2 = resolveEffectivePermissionSet(["PREFET_ETUDES"], grants2, {
      schoolId: schoolA.rows[0].id,
      countryId: country.rows[0].id,
    });
    const other2 = resolveEffectivePermissionSet(["PREFET_ETUDES"], grants2, {
      schoolId: schoolB.rows[0].id,
      countryId: country.rows[0].id,
    });
    assert.equal(nuru2.modules.students.canDelete, false, "override école A conserve DENY DELETE");
    assert.equal(other2.modules.students.canDelete, true, "école B hérite du global");

    const stale = await store.maxUpdatedAtForScope({
      roleKey: "PREFET_ETUDES",
      scopeType: "school",
      countryId: country.rows[0].id,
      schoolId: schoolA.rows[0].id,
    });
    await patchConfiguredPermissions(
      repo,
      {
        roleKey: "PREFET_ETUDES",
        schoolCode: "CD-2026-0001",
        expectedUpdatedAt: stale,
        grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: true, canDelete: false }],
      },
      superAdmin,
      {},
    );
    await assert.rejects(
      () =>
        patchConfiguredPermissions(
          repo,
          {
            roleKey: "PREFET_ETUDES",
            schoolCode: "CD-2026-0001",
            expectedUpdatedAt: first,
            grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: true, canDelete: true }],
          },
          superAdmin,
          {},
        ),
      (error) => error.statusCode === 409 && error.code === FUNCTIONAL_RBAC_ERROR.CONFLICT,
    );

    const auditsBefore = await pool.query(
      `SELECT COUNT(*)::int AS c FROM audit_logs WHERE action = 'ROLE_PERMISSION_MATRIX_UPDATED'`,
    );
    const failRepo = createRepo(pool, { failAudit: true });
    failRepo.getFunctionalRbacStore = () => createFunctionalRbacPgStore(failRepo);
    const currentUpdatedAt = await store.maxUpdatedAtForScope({
      roleKey: "PREFET_ETUDES",
      scopeType: "school",
      countryId: country.rows[0].id,
      schoolId: schoolA.rows[0].id,
    });
    await assert.rejects(
      () =>
        patchConfiguredPermissions(
          failRepo,
          {
            roleKey: "PREFET_ETUDES",
            schoolCode: "CD-2026-0001",
            expectedUpdatedAt: currentUpdatedAt,
            grants: [{ moduleKey: "students", canCreate: true, canRead: true, canUpdate: true, canDelete: true }],
          },
          superAdmin,
          {},
        ),
      (error) => String(error.message).includes("audit write failed"),
    );
    const grantsAfterFail = await store.listGrantsForScope({
      roleKey: "PREFET_ETUDES",
      scopeType: "school",
      countryId: country.rows[0].id,
      schoolId: schoolA.rows[0].id,
    });
    const studentGrant = grantsAfterFail.find((row) => row.moduleKey === "students");
    assert.equal(studentGrant.canCreate, false, "rollback si audit échoue");
    const auditsAfter = await pool.query(
      `SELECT COUNT(*)::int AS c FROM audit_logs WHERE action = 'ROLE_PERMISSION_MATRIX_UPDATED'`,
    );
    assert.equal(auditsAfter.rows[0].c, auditsBefore.rows[0].c);

    const schoolAdminAssignments = await store.listGrantsForScope({
      roleKey: "SCHOOL_ADMIN",
      scopeType: "global",
      countryId: null,
      schoolId: null,
    });
    const seededAssignments = schoolAdminAssignments.find((row) => row.moduleKey === "assignments");
    assert.ok(seededAssignments, "bootstrap initial insère assignments pour SCHOOL_ADMIN");
    assert.equal(seededAssignments.canCreate, true);
    assert.equal(seededAssignments.canDelete, false);

    await pool.query(
      `DELETE FROM role_module_permissions
        WHERE upper(role_key) = 'SCHOOL_ADMIN'
          AND module_key = 'assignments'
          AND scope_type = 'global'
          AND country_id IS NULL
          AND school_id IS NULL`,
    );
    await ensureFunctionalRbacBootstrap(repo);
    const restoredAssignments = (await store.listGrantsForScope({
      roleKey: "SCHOOL_ADMIN",
      scopeType: "global",
      countryId: null,
      schoolId: null,
    })).find((row) => row.moduleKey === "assignments");
    assert.ok(restoredAssignments, "backfill modules manquants restaure assignments");
    assert.equal(restoredAssignments.canCreate, true);
    assert.equal(restoredAssignments.canDelete, false);

    await store.upsertGrant({
      roleKey: "SCHOOL_ADMIN",
      scopeType: "global",
      countryId: null,
      schoolId: null,
      moduleKey: "assignments",
      canCreate: false,
      canRead: false,
      canUpdate: false,
      canDelete: false,
      updatedBy: "superadmin",
    });
    const countBeforeIdempotent = await store.countActiveGrants();
    await ensureFunctionalRbacBootstrap(repo);
    await ensureFunctionalRbacBootstrap(repo);
    const deniedAssignments = (await store.listGrantsForScope({
      roleKey: "SCHOOL_ADMIN",
      scopeType: "global",
      countryId: null,
      schoolId: null,
    })).find((row) => row.moduleKey === "assignments");
    assert.equal(deniedAssignments.canCreate, false, "DENY explicite non écrasé");
    assert.equal(deniedAssignments.canRead, false);
    assert.equal(await store.countActiveGrants(), countBeforeIdempotent, "bootstrap idempotent");

    const attendanceSchoolAt = await store.maxUpdatedAtForScope({
      roleKey: "PREFET_ETUDES",
      scopeType: "school",
      countryId: country.rows[0].id,
      schoolId: schoolA.rows[0].id,
    });
    await patchConfiguredPermissions(
      repo,
      {
        roleKey: "PREFET_ETUDES",
        schoolCode: "CD-2026-0001",
        expectedUpdatedAt: attendanceSchoolAt,
        grants: [
          { moduleKey: "attendance", canCreate: true, canRead: true, canUpdate: false, canDelete: false },
        ],
      },
      superAdmin,
      {},
    );
    const attendanceGrants = await store.listGrantsForRoles(["PREFET_ETUDES"]);
    const attendanceA = resolveEffectivePermissionSet(["PREFET_ETUDES"], attendanceGrants, {
      schoolId: schoolA.rows[0].id,
      countryId: country.rows[0].id,
    });
    const attendanceB = resolveEffectivePermissionSet(["PREFET_ETUDES"], attendanceGrants, {
      schoolId: schoolB.rows[0].id,
      countryId: country.rows[0].id,
    });
    assert.equal(attendanceA.modules.attendance.canCreate, true, "école A CREATE présence");
    assert.equal(attendanceA.permissions.includes("Présences:CREATE"), true);
    assert.equal(attendanceB.modules.attendance.canCreate, false, "école B sans grant école → pas de CREATE local");

    const attendanceSchoolAt2 = await store.maxUpdatedAtForScope({
      roleKey: "PREFET_ETUDES",
      scopeType: "school",
      countryId: country.rows[0].id,
      schoolId: schoolA.rows[0].id,
    });
    await patchConfiguredPermissions(
      repo,
      {
        roleKey: "PREFET_ETUDES",
        schoolCode: "CD-2026-0001",
        expectedUpdatedAt: attendanceSchoolAt2,
        grants: [
          { moduleKey: "attendance", canCreate: false, canRead: true, canUpdate: false, canDelete: false },
        ],
      },
      superAdmin,
      {},
    );
    const deniedAttendance = resolveEffectivePermissionSet(
      ["PREFET_ETUDES"],
      await store.listGrantsForRoles(["PREFET_ETUDES"]),
      { schoolId: schoolA.rows[0].id, countryId: country.rows[0].id },
    );
    assert.equal(deniedAttendance.modules.attendance.canCreate, false, "DENY école A masque un CREATE global éventuel");

    await assert.rejects(
      () =>
        patchConfiguredPermissions(
          repo,
          {
            roleKey: "SUPER_ADMIN",
            schoolCode: "CD-2026-0001",
            grants: [{ moduleKey: "users", canCreate: true, canRead: false, canUpdate: true, canDelete: true }],
          },
          superAdmin,
          {},
        ),
      (error) => error.statusCode === 409 && error.code === FUNCTIONAL_RBAC_ERROR.MANDATORY_PERMISSION,
    );
    await assert.rejects(
      () =>
        patchConfiguredPermissions(
          repo,
          {
            roleKey: "PREFET_ETUDES",
            schoolCode: "CD-2026-0001",
            expectedUpdatedAt: attendanceSchoolAt2,
            grants: [
              { moduleKey: "attendance", canCreate: true, canRead: false, canUpdate: false, canDelete: false },
            ],
          },
          superAdmin,
          {},
        ),
      (error) => error.statusCode === 409 && error.code === FUNCTIONAL_RBAC_ERROR.MANDATORY_PERMISSION,
    );
    const stillDenied = resolveEffectivePermissionSet(
      ["PREFET_ETUDES"],
      await store.listGrantsForRoles(["PREFET_ETUDES"]),
      { schoolId: schoolA.rows[0].id, countryId: country.rows[0].id },
    );
    assert.equal(stillDenied.modules.attendance.canCreate, false, "aucune écriture si MANDATORY_PERMISSION");

    const gradesSchoolAt = await store.maxUpdatedAtForScope({
      roleKey: "PREFET_ETUDES",
      scopeType: "school",
      countryId: country.rows[0].id,
      schoolId: schoolA.rows[0].id,
    });
    await patchConfiguredPermissions(
      repo,
      {
        roleKey: "PREFET_ETUDES",
        schoolCode: "CD-2026-0001",
        expectedUpdatedAt: gradesSchoolAt,
        grants: [{ moduleKey: "grades", canCreate: true, canRead: true, canUpdate: false, canDelete: false }],
      },
      superAdmin,
      {},
    );
    await store.upsertGrant({
      roleKey: "PREFET_ETUDES",
      scopeType: "school",
      countryId: country.rows[0].id,
      schoolId: schoolB.rows[0].id,
      moduleKey: "grades",
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
      updatedBy: "superadmin",
    });
    await store.upsertGrant({
      roleKey: "TEACHER",
      scopeType: "global",
      countryId: null,
      schoolId: null,
      moduleKey: "grades",
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      updatedBy: "bootstrap",
    });
    const gradeRows = await store.listGrantsForRoles(["PREFET_ETUDES", "TEACHER"]);
    const gradesA = resolveEffectivePermissionSet(["PREFET_ETUDES"], gradeRows, {
      schoolId: schoolA.rows[0].id,
      countryId: country.rows[0].id,
    });
    const gradesB = resolveEffectivePermissionSet(["PREFET_ETUDES"], gradeRows, {
      schoolId: schoolB.rows[0].id,
      countryId: country.rows[0].id,
    });
    assert.equal(gradesA.modules.grades.canCreate, true, "école A Notes:CREATE");
    assert.equal(gradesA.permissions.includes("Notes:CREATE"), true);
    assert.equal(gradesB.modules.grades.canCreate, false, "DENY école B masque CREATE");
    const unionGrades = resolveEffectivePermissionSet(["PREFET_ETUDES", "TEACHER"], gradeRows, {
      schoolId: schoolB.rows[0].id,
      countryId: country.rows[0].id,
    });
    assert.equal(unionGrades.modules.grades.canCreate, true, "multi-rôle TEACHER CREATE union OR");
    const revokedTeacher = resolveEffectivePermissionSet(["PREFET_ETUDES"], gradeRows, {
      schoolId: schoolB.rows[0].id,
      countryId: country.rows[0].id,
    });
    assert.equal(revokedTeacher.modules.grades.canCreate, false, "rôle TEACHER révoqué ignoré");

    const newer = "2026-08-25T18:14:47.020Z";
    const older = "2026-08-25T18:14:47.010Z";
    await store.upsertGrant({
      roleKey: "SECRETARY",
      scopeType: "school",
      countryId: country.rows[0].id,
      schoolId: schoolA.rows[0].id,
      moduleKey: "grades",
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
      updatedAt: newer,
      updatedBy: "test-a",
    });
    await store.upsertGrant({
      roleKey: "SECRETARY",
      scopeType: "school",
      countryId: country.rows[0].id,
      schoolId: schoolA.rows[0].id,
      moduleKey: "students",
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: true,
      updatedAt: older,
      updatedBy: "test-a",
    });
    const secretaryMax = await store.maxUpdatedAtForScope({
      roleKey: "SECRETARY",
      scopeType: "school",
      countryId: country.rows[0].id,
      schoolId: schoolA.rows[0].id,
    });
    assert.equal(new Date(secretaryMax).getTime(), new Date(newer).getTime());
    const patchedOlderRow = await patchConfiguredPermissions(
      repo,
      {
        roleKey: "SECRETARY",
        schoolCode: "CD-2026-0001",
        expectedUpdatedAt: secretaryMax,
        grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: false, canDelete: false }],
      },
      superAdmin,
      {},
    );
    assert.ok(
      new Date(patchedOlderRow.updatedAt).getTime() > new Date(newer).getTime(),
      "TEST A PG : jeton scope > ancien MAX",
    );
    await assert.rejects(
      () =>
        patchConfiguredPermissions(
          repo,
          {
            roleKey: "SECRETARY",
            schoolCode: "CD-2026-0001",
            expectedUpdatedAt: secretaryMax,
            grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: false, canDelete: true }],
          },
          superAdmin,
          {},
        ),
      (error) => error.statusCode === 409 && error.code === FUNCTIONAL_RBAC_ERROR.CONFLICT,
    );

    const concurrentToken = await store.maxUpdatedAtForScope({
      roleKey: "SECRETARY",
      scopeType: "school",
      countryId: country.rows[0].id,
      schoolId: schoolA.rows[0].id,
    });
    const studentsBefore = (await store.listGrantsForScope({
      roleKey: "SECRETARY",
      scopeType: "school",
      countryId: country.rows[0].id,
      schoolId: schoolA.rows[0].id,
    })).find((row) => row.moduleKey === "students");
    const gradesBefore = (await store.listGrantsForScope({
      roleKey: "SECRETARY",
      scopeType: "school",
      countryId: country.rows[0].id,
      schoolId: schoolA.rows[0].id,
    })).find((row) => row.moduleKey === "grades");

    let arrived = 0;
    let releaseBarrier;
    const bothBegun = new Promise((resolve) => {
      releaseBarrier = resolve;
    });
    function withBeginBarrier(baseRepo) {
      const original = baseRepo.withTransaction.bind(baseRepo);
      baseRepo.withTransaction = async (fn) =>
        original(async (tx) => {
          arrived += 1;
          if (arrived >= 2) releaseBarrier();
          await bothBegun;
          return fn(tx);
        });
      return baseRepo;
    }
    const repoA = withBeginBarrier(createRepo(pool));
    const repoB = withBeginBarrier(createRepo(pool));
    const concurrent = await Promise.allSettled([
      patchConfiguredPermissions(
        repoA,
        {
          roleKey: "SECRETARY",
          schoolCode: "CD-2026-0001",
          expectedUpdatedAt: concurrentToken,
          grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: false, canDelete: true }],
        },
        superAdmin,
        {},
      ),
      patchConfiguredPermissions(
        repoB,
        {
          roleKey: "SECRETARY",
          schoolCode: "CD-2026-0001",
          expectedUpdatedAt: concurrentToken,
          grants: [{ moduleKey: "grades", canCreate: true, canRead: true, canUpdate: false, canDelete: false }],
        },
        superAdmin,
        {},
      ),
    ]);
    const accepted = concurrent.filter((row) => row.status === "fulfilled");
    const rejected = concurrent.filter(
      (row) =>
        row.status === "rejected" &&
        row.reason?.statusCode === 409 &&
        row.reason?.code === FUNCTIONAL_RBAC_ERROR.CONFLICT,
    );
    assert.equal(accepted.length, 1, "TEST B : une seule transaction réussit");
    assert.equal(rejected.length, 1, "TEST B : l'autre reçoit 409 CONFLICT");
    const afterConcurrent = await store.listGrantsForScope({
      roleKey: "SECRETARY",
      scopeType: "school",
      countryId: country.rows[0].id,
      schoolId: schoolA.rows[0].id,
    });
    const studentsAfter = afterConcurrent.find((row) => row.moduleKey === "students");
    const gradesAfter = afterConcurrent.find((row) => row.moduleKey === "grades");
    const studentsChanged = Boolean(studentsAfter.canDelete) !== Boolean(studentsBefore.canDelete);
    const gradesChanged = Boolean(gradesAfter.canCreate) !== Boolean(gradesBefore.canCreate);
    assert.equal(
      studentsChanged && gradesChanged,
      false,
      "TEST B : pas de lost update — un seul delta appliqué",
    );
    assert.equal(studentsChanged || gradesChanged, true, "TEST B : le gagnant a bien écrit");

    console.log("functionalRbac.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
