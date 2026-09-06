"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { PostgresRepository } = require("../db/postgresRepository");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");
const { USER_ROLES_MIGRATION_AMBIGUOUS, NORMALIZE_ROLE_CODE_FUNCTION_SQL } = require("../db/userRolesSchema");
const { ESTABLISHMENT_ROLES_SCHEMA_SQL } = require("../db/establishmentRolesSchema");
const { normalizeRoleCode } = require("./establishmentRolesManagement");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_USER_ROLES_MIGRATION_IT_DATABASE ?? "somafrik_user_roles_migration_it")
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

function createEnsureAdapter(pool) {
  return {
    all: async (sql, params) => (await pool.query(sql, params)).rows,
    query: (sql, params) => pool.query(sql, params),
  };
}

async function applyUserRolesCanonical(pool) {
  await PostgresRepository.prototype.ensureUserRolesCanonicalSchema.call(createEnsureAdapter(pool));
}

async function seedCountryAndSchools(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  const countryId = country.rows[0].id;
  const schoolA = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'CD-2026-0001', 'Kin', 'active') RETURNING id`,
    [countryId],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'BI-2026-0002', 'Buj', 'active') RETURNING id`,
    [countryId],
  );
  return { schoolA: schoolA.rows[0].id, schoolB: schoolB.rows[0].id };
}

async function insertUser(pool, { schoolId, userCode, firstName, lastName, role }) {
  const result = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, role, status)
     VALUES ($1, $2, $3, $4, $5, 'active')
     RETURNING id, user_code, role`,
    [schoolId, userCode, firstName, lastName, role],
  );
  return result.rows[0];
}

async function main() {
  if (!DATABASE_URL) {
    console.log("userRolesMigration.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);

    await applyUserRolesCanonical(pool);
    await applyUserRolesCanonical(pool);

    const indexes = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname IN ('user_roles_active_school_unique', 'user_roles_active_platform_unique')
       ORDER BY indexname`,
    );
    assert.equal(indexes.rowCount, 2, "index uniques actifs présents après rerun");

    const { schoolA, schoolB } = await seedCountryAndSchools(pool);
    const teacher = await insertUser(pool, {
      schoolId: schoolA,
      userCode: "USR-2026-00001",
      firstName: "Fatou",
      lastName: "Sow",
      role: "Enseignant",
    });
    const unaffect = await insertUser(pool, {
      schoolId: schoolA,
      userCode: "USR-2026-00002",
      firstName: "Marie",
      lastName: "Kabeya",
      role: null,
    });
    const otherTenant = await insertUser(pool, {
      schoolId: schoolB,
      userCode: "USR-2026-00003",
      firstName: "Jean",
      lastName: "Ndaye",
      role: "Secrétaire",
    });
    const ambiguous = await insertUser(pool, {
      schoolId: schoolA,
      userCode: "USR-2026-00004",
      firstName: "Role",
      lastName: "Inconnu",
      role: "Wizard",
    });

    await pool.query(`DELETE FROM user_roles`);
    await assert.rejects(
      () => applyUserRolesCanonical(pool),
      (error) => error.code === USER_ROLES_MIGRATION_AMBIGUOUS,
      "rôle legacy ambigu → USER_ROLES_MIGRATION_AMBIGUOUS",
    );
    assert.equal(
      (await pool.query(`SELECT COUNT(*)::int AS count FROM users`)).rows[0].count,
      4,
      "aucun compte perdu sur ambiguïté",
    );
    assert.equal(
      (await pool.query(`SELECT COUNT(*)::int AS count FROM user_roles`)).rows[0].count,
      0,
      "aucun backfill si inventaire fail-closed",
    );

    await pool.query(`DELETE FROM users WHERE id = $1`, [ambiguous.id]);
    await applyUserRolesCanonical(pool);
    await applyUserRolesCanonical(pool);

    const backfilled = await pool.query(
      `SELECT user_id, school_id, role_key, status
       FROM user_roles
       WHERE status = 'active'
       ORDER BY role_key, user_id`,
    );
    assert.equal(backfilled.rowCount, 2);
    const byUser = Object.fromEntries(
      backfilled.rows.map((row) => [row.user_id, row]),
    );
    assert.equal(byUser[teacher.id].role_key, "TEACHER");
    assert.equal(String(byUser[teacher.id].school_id), String(schoolA));
    assert.equal(byUser[otherTenant.id].role_key, "SECRETARY");
    assert.equal(String(byUser[otherTenant.id].school_id), String(schoolB));
    assert.equal(
      backfilled.rows.some((row) => String(row.user_id) === String(unaffect.id)),
      false,
      "utilisateur sans rôle : aucune ligne user_roles",
    );

    const usersAfter = await pool.query(`SELECT id FROM users ORDER BY user_code`);
    assert.deepEqual(
      usersAfter.rows.map((row) => row.id),
      [teacher.id, unaffect.id, otherTenant.id],
    );

    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO user_roles (user_id, school_id, role_key, status)
           VALUES ($1, $2, 'TEACHER', 'active')`,
          [teacher.id, schoolA],
        ),
      /user_roles_active_school_unique/,
    );

    await ensureClientsCanonicalBootstrap(pool, { info() {}, error() {} });
    await pool.query(
      `UPDATE users SET profile_payload = '{"secondaryRoles":["Enseignant"]}'::jsonb WHERE id = $1`,
      [unaffect.id],
    );
    await applyUserRolesCanonical(pool);
    const secondary = await pool.query(
      `SELECT role_key FROM user_roles WHERE user_id = $1 AND status = 'active' ORDER BY role_key`,
      [unaffect.id],
    );
    assert.deepEqual(
      secondary.rows.map((row) => row.role_key),
      ["TEACHER"],
      "backfill secondaryRoles après ajout de profile_payload",
    );

    const ambiguousSecondary = await insertUser(pool, {
      schoolId: schoolA,
      userCode: "USR-2026-00005",
      firstName: "Second",
      lastName: "Ambigu",
      role: null,
    });
    await pool.query(
      `UPDATE users SET profile_payload = '{"secondaryRoles":["Wizard"]}'::jsonb WHERE id = $1`,
      [ambiguousSecondary.id],
    );
    const usersBeforeSecondaryFail = (await pool.query(`SELECT COUNT(*)::int AS count FROM users`)).rows[0].count;
    const rolesBeforeSecondaryFail = (await pool.query(`SELECT COUNT(*)::int AS count FROM user_roles`)).rows[0]
      .count;
    await assert.rejects(
      () => applyUserRolesCanonical(pool),
      (error) => error.code === USER_ROLES_MIGRATION_AMBIGUOUS,
      "secondaryRoles legacy ambigu → USER_ROLES_MIGRATION_AMBIGUOUS",
    );
    assert.equal(
      (await pool.query(`SELECT COUNT(*)::int AS count FROM users`)).rows[0].count,
      usersBeforeSecondaryFail,
      "aucun compte perdu sur ambiguïté secondaryRoles",
    );
    assert.equal(
      (await pool.query(`SELECT COUNT(*)::int AS count FROM user_roles`)).rows[0].count,
      rolesBeforeSecondaryFail,
      "aucun backfill si secondaryRoles fail-closed",
    );

    await pool.query(`DELETE FROM users WHERE id = $1`, [ambiguousSecondary.id]);
    await pool.query(ESTABLISHMENT_ROLES_SCHEMA_SQL);
    await pool.query(NORMALIZE_ROLE_CODE_FUNCTION_SQL);

    const normalizeSamples = [
      "CONSEILLER_PÉDAGOGIQUE",
      "Conseiller pédagogique",
      "conseiller_pedagogique",
      "  Conseiller   Pédagogique  ",
      "CONSEILLER-PÉDAGOGIQUE",
      "Préfet des études",
    ];
    for (const sample of normalizeSamples) {
      const sqlNorm = (
        await pool.query(`SELECT somafrik_normalize_role_code($1) AS code`, [sample])
      ).rows[0].code;
      assert.equal(sqlNorm, normalizeRoleCode(sample), `SQL/JS normalize diverge pour ${sample}`);
    }
    assert.equal(
      (await pool.query(`SELECT somafrik_normalize_role_code($1) AS code`, ["CONSEILLER_PÉDAGOGIQUE"])).rows[0]
        .code,
      "conseiller_pedagogique",
    );

    await pool.query(
      `INSERT INTO establishment_roles (role_code, role_name, scope, status, school_assignable)
       VALUES ('conseiller_pedagogique', 'Conseiller pédagogique', 'school', 'active', TRUE)`,
    );

    const counselor = await insertUser(pool, {
      schoolId: schoolA,
      userCode: "USR-2026-00011",
      firstName: "Paul",
      lastName: "Mbala",
      role: "CONSEILLER_PÉDAGOGIQUE",
    });
    const usersRoleBefore = (
      await pool.query(`SELECT role FROM users WHERE id = $1`, [counselor.id])
    ).rows[0].role;
    await applyUserRolesCanonical(pool);
    await applyUserRolesCanonical(pool);
    const counselorRole = await pool.query(
      `SELECT role_key, status FROM user_roles WHERE user_id = $1 AND status = 'active'`,
      [counselor.id],
    );
    assert.equal(counselorRole.rowCount, 1);
    assert.equal(counselorRole.rows[0].role_key, "conseiller_pedagogique");
    assert.equal(
      (await pool.query(`SELECT role FROM users WHERE id = $1`, [counselor.id])).rows[0].role,
      usersRoleBefore,
      "users.role ne doit pas être muté",
    );
    assert.equal(usersRoleBefore, "CONSEILLER_PÉDAGOGIQUE");
    assert.equal(
      String(
        (await pool.query(`SELECT school_id FROM user_roles WHERE user_id = $1`, [counselor.id])).rows[0].school_id,
      ),
      String(schoolA),
      "rôle établissement backfillé avec le school_id de l'utilisateur",
    );

    const platformAdmin = await insertUser(pool, {
      schoolId: null,
      userCode: "USR-2026-00016",
      firstName: "Super",
      lastName: "Plateforme",
      role: "SUPER_ADMIN",
    });
    await applyUserRolesCanonical(pool);
    const platformRow = await pool.query(
      `SELECT school_id, role_key, status FROM user_roles WHERE user_id = $1 AND status = 'active'`,
      [platformAdmin.id],
    );
    assert.equal(platformRow.rowCount, 1);
    assert.equal(platformRow.rows[0].role_key, "SUPER_ADMIN");
    assert.equal(platformRow.rows[0].school_id, null, "rôle plateforme school_id NULL inchangé");

    const orphanCatalog = await insertUser(pool, {
      schoolId: null,
      userCode: "USR-2026-00017",
      firstName: "Orphelin",
      lastName: "Catalogue",
      role: "CONSEILLER_PÉDAGOGIQUE",
    });
    const rolesBeforeOrphan = (await pool.query(`SELECT COUNT(*)::int AS count FROM user_roles`)).rows[0].count;
    await assert.rejects(
      () => applyUserRolesCanonical(pool),
      (error) => error.code === USER_ROLES_MIGRATION_AMBIGUOUS,
      "rôle établissement sans school_id → USER_ROLES_MIGRATION_AMBIGUOUS",
    );
    assert.equal(
      (await pool.query(`SELECT COUNT(*)::int AS count FROM user_roles`)).rows[0].count,
      rolesBeforeOrphan,
      "aucun user_roles créé pour un rôle établissement sans tenant",
    );
    assert.equal(
      (await pool.query(`SELECT COUNT(*)::int AS count FROM user_roles WHERE user_id = $1`, [orphanCatalog.id])).rows[0]
        .count,
      0,
    );
    assert.equal(
      (await pool.query(`SELECT role FROM users WHERE id = $1`, [orphanCatalog.id])).rows[0].role,
      "CONSEILLER_PÉDAGOGIQUE",
      "users.role non muté sur refus sans school_id",
    );
    await pool.query(`DELETE FROM users WHERE id = $1`, [orphanCatalog.id]);

    const orphanSecondary = await insertUser(pool, {
      schoolId: null,
      userCode: "USR-2026-00018",
      firstName: "Second",
      lastName: "Orphelin",
      role: null,
    });
    await pool.query(
      `UPDATE users SET profile_payload = '{"secondaryRoles":["CONSEILLER_PÉDAGOGIQUE"]}'::jsonb WHERE id = $1`,
      [orphanSecondary.id],
    );
    const rolesBeforeOrphanSecondary = (await pool.query(`SELECT COUNT(*)::int AS count FROM user_roles`)).rows[0]
      .count;
    await assert.rejects(
      () => applyUserRolesCanonical(pool),
      (error) => error.code === USER_ROLES_MIGRATION_AMBIGUOUS,
      "secondaryRole établissement sans school_id → USER_ROLES_MIGRATION_AMBIGUOUS",
    );
    assert.equal(
      (await pool.query(`SELECT COUNT(*)::int AS count FROM user_roles`)).rows[0].count,
      rolesBeforeOrphanSecondary,
      "aucun user_roles créé pour secondaryRole dynamique sans tenant",
    );
    await pool.query(`DELETE FROM users WHERE id = $1`, [orphanSecondary.id]);
    await applyUserRolesCanonical(pool);

    const secondaryCounselor = await insertUser(pool, {
      schoolId: schoolA,
      userCode: "USR-2026-00012",
      firstName: "Amina",
      lastName: "Diallo",
      role: null,
    });
    await pool.query(
      `UPDATE users SET profile_payload = '{"secondaryRoles":["CONSEILLER_PÉDAGOGIQUE"]}'::jsonb WHERE id = $1`,
      [secondaryCounselor.id],
    );
    await applyUserRolesCanonical(pool);
    const secondaryCatalog = await pool.query(
      `SELECT role_key FROM user_roles WHERE user_id = $1 AND status = 'active'`,
      [secondaryCounselor.id],
    );
    assert.deepEqual(
      secondaryCatalog.rows.map((row) => row.role_key),
      ["conseiller_pedagogique"],
      "secondaryRoles CONSEILLER_PÉDAGOGIQUE → conseiller_pedagogique",
    );

    const unknownDynamic = await insertUser(pool, {
      schoolId: schoolA,
      userCode: "USR-2026-00013",
      firstName: "Inconnu",
      lastName: "Dynamique",
      role: "Alchimiste",
    });
    await assert.rejects(
      () => applyUserRolesCanonical(pool),
      (error) => error.code === USER_ROLES_MIGRATION_AMBIGUOUS,
      "rôle dynamique inconnu → USER_ROLES_MIGRATION_AMBIGUOUS",
    );
    await pool.query(`DELETE FROM users WHERE id = $1`, [unknownDynamic.id]);

    await pool.query(
      `INSERT INTO establishment_roles (role_code, role_name, scope, status, school_assignable)
       VALUES ('archiviste_pedagogique', 'Archiviste pédagogique', 'school', 'archived', TRUE)`,
    );
    const archivedUser = await insertUser(pool, {
      schoolId: schoolA,
      userCode: "USR-2026-00014",
      firstName: "Archive",
      lastName: "Role",
      role: "ARCHIVISTE_PÉDAGOGIQUE",
    });
    await assert.rejects(
      () => applyUserRolesCanonical(pool),
      (error) => error.code === USER_ROLES_MIGRATION_AMBIGUOUS,
      "rôle établissement archivé → USER_ROLES_MIGRATION_AMBIGUOUS",
    );
    await pool.query(`DELETE FROM users WHERE id = $1`, [archivedUser.id]);

    await pool.query(
      `INSERT INTO establishment_roles (role_code, role_name, scope, status, school_assignable)
       VALUES ('conseiller_pedagogique_bis', 'CONSEILLER_PÉDAGOGIQUE', 'school', 'active', TRUE)`,
    );
    const ambiguousCatalog = await insertUser(pool, {
      schoolId: schoolA,
      userCode: "USR-2026-00015",
      firstName: "Ambig",
      lastName: "Catalog",
      role: "CONSEILLER_PÉDAGOGIQUE",
    });
    await assert.rejects(
      () => applyUserRolesCanonical(pool),
      (error) => error.code === USER_ROLES_MIGRATION_AMBIGUOUS,
      "résolution catalogue ambiguë → USER_ROLES_MIGRATION_AMBIGUOUS",
    );
    await pool.query(`DELETE FROM users WHERE id = $1`, [ambiguousCatalog.id]);
    await pool.query(`DELETE FROM establishment_roles WHERE role_code = 'conseiller_pedagogique_bis'`);

    const teacherStill = await pool.query(
      `SELECT role_key FROM user_roles WHERE user_id = $1 AND status = 'active'`,
      [teacher.id],
    );
    assert.equal(teacherStill.rows[0].role_key, "TEACHER", "rôle statique historique inchangé");

    const legacyDirector = await insertUser(pool, {
      schoolId: schoolA,
      userCode: "USR-2026-00021",
      firstName: "Directeur",
      lastName: "Lie",
      role: "Directeur",
    });
    const linkedFiche = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1, 'CD-IN-DL-26-00099', 'Directeur', 'Lie', 'active')
       RETURNING id`,
      [schoolA],
    );
    await pool.query(`UPDATE students SET user_id = $1 WHERE id = $2`, [
      legacyDirector.id,
      linkedFiche.rows[0].id,
    ]);
    await applyUserRolesCanonical(pool);
    const skippedStaff = await pool.query(
      `SELECT role_key FROM user_roles WHERE user_id = $1 AND status = 'active' ORDER BY role_key`,
      [legacyDirector.id],
    );
    assert.deepEqual(
      skippedStaff.rows.map((row) => row.role_key),
      [],
      "backfill n'ajoute pas Directeur sur un compte lié (pas de remediation, pas de nouvel anomalie)",
    );
    assert.equal(
      (await pool.query(`SELECT role FROM users WHERE id = $1`, [legacyDirector.id])).rows[0].role,
      "Directeur",
      "users.role legacy inchangé",
    );

    await pool.query(`DROP TRIGGER IF EXISTS user_roles_student_role_lock ON user_roles`);
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES ($1, $2, 'PRINCIPAL', 'active')`,
      [legacyDirector.id, schoolA],
    );
    await applyUserRolesCanonical(pool);
    const keptAnomaly = await pool.query(
      `SELECT role_key FROM user_roles WHERE user_id = $1 AND status = 'active' ORDER BY role_key`,
      [legacyDirector.id],
    );
    assert.deepEqual(
      keptAnomaly.rows.map((row) => row.role_key),
      ["PRINCIPAL"],
      "anomalie user_roles existante conservée ; boot ne lève pas STUDENT_ROLE_LOCKED",
    );
    const triggerOn = await pool.query(
      `SELECT 1 FROM pg_trigger WHERE tgname = 'user_roles_student_role_lock'`,
    );
    assert.equal(triggerOn.rowCount, 1, "trigger repose après backfill");
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO user_roles (user_id, school_id, role_key, status)
           VALUES ($1, $2, 'TEACHER', 'active')`,
          [legacyDirector.id, schoolA],
        ),
      /STUDENT_ROLE_LOCKED/,
    );

    const receiver = await insertUser(pool, {
      schoolId: schoolA,
      userCode: "USR-2026-00022",
      firstName: "Staff",
      lastName: "Cible",
      role: null,
    });
    await assert.rejects(
      () =>
        pool.query(`UPDATE user_roles SET user_id = $1 WHERE user_id = $2 AND role_key = 'PRINCIPAL'`, [
          receiver.id,
          legacyDirector.id,
        ]),
      /STUDENT_ROLE_LOCKED/,
      "transfert de rôle hors du compte lié interdit",
    );
    assert.equal(
      (
        await pool.query(
          `SELECT COUNT(*)::int AS count FROM user_roles WHERE user_id = $1 AND role_key = 'PRINCIPAL' AND status = 'active'`,
          [legacyDirector.id],
        )
      ).rows[0].count,
      1,
    );
    assert.equal(
      (
        await pool.query(
          `SELECT COUNT(*)::int AS count FROM user_roles WHERE user_id = $1`,
          [receiver.id],
        )
      ).rows[0].count,
      0,
    );

    console.log("userRolesMigration.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
