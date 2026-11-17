"use strict";

/**
 * AUDIT-SETUP-GUIDED-10-01 — compteurs PostgreSQL réels des 10 étapes guidées.
 *
 * Banc jetable : une base au nom tiré au sort est créée sur une instance loopback,
 * le schéma canonique est appliqué par `repository.init()`, puis supprimée.
 * Aucune base préexistante n'est réutilisée, vidée ni supprimée.
 * Un SKIP n'est pas une validation : DATABASE_URL est obligatoire.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { guardPgPool } = require("./pgPoolGuard");
const { waitForNoDatabaseSessions } = require("./pgTestLifecycle");
const { mapEstablishmentRow } = require("./schoolsManagement");
const { loadSchoolSetupGuidedSnapshot, stepSatisfied, GUIDED_STEP_KEYS } = require("./schoolSetupGuided");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const WORK_NAME = /^somafrik_test_guided10_[0-9a-f]{12}$/;

function assertLocalTestInstance(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) throw new Error(`Refus: hôte PostgreSQL non local (${host}).`);
  for (const key of ["host", "hostaddr"]) {
    const override = String(parsed.searchParams.get(key) ?? "").toLowerCase();
    if (override && !LOOPBACK_HOSTS.has(override)) throw new Error(`Refus: paramètre ${key} non local.`);
  }
  if (/prod|preprod/i.test(`${host} ${parsed.pathname}`)) throw new Error("Refus: cible prod ou préprod.");
  if (String(process.env.NODE_ENV ?? "").toLowerCase() === "production" || String(process.env.RENDER ?? "") !== "") {
    throw new Error("Refus: environnement de production.");
  }
}

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

const state = { name: null, url: null, pool: null, repo: null, ids: {} };

async function adminQuery(sql, params) {
  assertLocalTestInstance(DATABASE_URL);
  const admin = guardPgPool(new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres"), max: 1 }));
  try {
    return await admin.query(sql, params);
  } finally {
    await admin.end();
  }
}

async function setLoginCodeTriggers(pool, enabled) {
  const action = enabled ? "ENABLE" : "DISABLE";
  await pool.query(`
    DO $trg$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_schools_login_code_insert') THEN
        EXECUTE 'ALTER TABLE schools ${action} TRIGGER zz_schools_login_code_insert';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_schools_login_code_update') THEN
        EXECUTE 'ALTER TABLE schools ${action} TRIGGER zz_schools_login_code_update';
      END IF;
    END
    $trg$;
  `);
}

async function one(sql, params) {
  const result = await state.pool.query(sql, params);
  return result.rows[0] ?? null;
}

async function insertId(sql, params) {
  return (await state.pool.query(sql, params)).rows[0].id;
}

/**
 * Établissement complet pour les étapes 1 à 10, dont chaque élément utile peut
 * ensuite être archivé, retiré ou vidé par un test.
 */
let shortCodeSeq = 0;

async function seedSchool(countryId, prefix, profile = {}) {
  shortCodeSeq += 1;
  const shortCode = `T${String(shortCodeSeq).padStart(2, "0")}`;
  const schoolId = await insertId(
    `INSERT INTO schools (country_id, school_code, short_code, name, address, city, phone, status, profile_payload)
     VALUES ($1, $2, $3, $4, $5, 'Bujumbura', $6, 'active', $7::jsonb) RETURNING id`,
    [
      countryId,
      `BI-2026-${prefix}`,
      shortCode,
      `École ${prefix}`,
      profile.address ?? "Avenue de test 1",
      profile.phone ?? "+25700000000",
      JSON.stringify(profile.payload ?? {}),
    ],
  );
  const yearId = await insertId(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2025-2026', '2025-09-01', '2026-08-31', TRUE, 'open') RETURNING id`,
    [schoolId],
  );
  const levelId = await insertId(
    `INSERT INTO education_levels (country_id, level_code, name, status) VALUES ($1, $2, '6ème', 'active') RETURNING id`,
    [countryId, `L-${prefix}`],
  );
  const groupId = await insertId(
    `INSERT INTO education_class_groups (country_id, group_code, name, status) VALUES ($1, $2, 'A', 'active') RETURNING id`,
    [countryId, `G-${prefix}`],
  );
  await state.pool.query(`INSERT INTO school_levels (school_id, level_id, status) VALUES ($1, $2, 'active')`, [schoolId, levelId]);
  await state.pool.query(`INSERT INTO school_class_groups (school_id, group_id, status) VALUES ($1, $2, 'active')`, [schoolId, groupId]);
  const classId = await insertId(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, level, status, level_id, group_id, group_code)
     VALUES ($1, $2, $3, '6ème A', '6ème', 'active', $4, $5, 'A') RETURNING id`,
    [schoolId, yearId, `CLS-${prefix}`, levelId, groupId],
  );
  const subjectId = await insertId(
    `INSERT INTO subjects (school_id, subject_code, name, status) VALUES ($1, $2, 'Mathématiques', 'active') RETURNING id`,
    [schoolId, `MAT-${prefix}`],
  );
  const teacherId = await insertId(
    `INSERT INTO teachers (school_id, teacher_code, status) VALUES ($1, $2, 'active') RETURNING id`,
    [schoolId, `ENS-${prefix}`],
  );
  await state.pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [schoolId, teacherId, classId, subjectId, yearId],
  );
  const studentId = await insertId(
    `INSERT INTO students (school_id, student_code, first_name, last_name) VALUES ($1, $2, 'Élève', $3) RETURNING id`,
    [schoolId, `ELV-${prefix}`, prefix],
  );
  await state.pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status) VALUES ($1, $2, $3, $4, 'ENROLLED')`,
    [schoolId, studentId, classId, yearId],
  );
  await state.pool.query(
    `INSERT INTO school_payment_methods (school_id, method_code, label, is_active) VALUES ($1, 'CASH', 'Espèces', TRUE)`,
    [schoolId],
  );
  await state.pool.query(
    `INSERT INTO evaluation_types (school_id, code, name, status) VALUES ($1, 'DEVOIR', 'Devoir', 'active')`,
    [schoolId],
  );
  await state.pool.query(
    `INSERT INTO school_notification_settings (school_id, event_key, recipient_category, channel, enabled)
     VALUES ($1, 'STUDENT_ABSENT', 'PARENT', 'IN_APP', TRUE)`,
    [schoolId],
  );
  const userId = await insertId(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES ($1, $2, 'Admin', $3, $4, 'Admin School', 'active', FALSE) RETURNING id`,
    [schoolId, `ADM-${prefix}`, prefix, `admin-${prefix.toLowerCase()}@audit10.test`],
  );
  return { schoolId, yearId, classId, subjectId, teacherId, studentId, userId };
}

before(async () => {
  if (process.env.GITHUB_ACTIONS && !DATABASE_URL) {
    throw new Error("DATABASE_URL requis en GitHub Actions — ce banc ne peut pas être SKIP.");
  }
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL requis — un test PostgreSQL ignoré ne valide pas AUDIT-SETUP-GUIDED-10-01.");
  }
  assertLocalTestInstance(DATABASE_URL);
  const name = `somafrik_test_guided10_${crypto.randomBytes(6).toString("hex")}`;
  assert.match(name, WORK_NAME);
  const existing = await adminQuery("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (existing.rowCount) throw new Error(`Refus: base préexistante (${name}).`);
  await adminQuery(`CREATE DATABASE ${name}`);
  state.name = name;
  state.url = withDatabaseName(DATABASE_URL, name);

  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  state.repo = createPostgresRepository(state.url);
  await state.repo.init();
  state.pool = guardPgPool(new Pool({ connectionString: state.url, max: 2 }));
  await state.pool.query(`
    ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
    ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
  `);
  await setLoginCodeTriggers(state.pool, false);
  const bi = await one(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('Burundi', 'BI', '+257', 'BIF')
     ON CONFLICT (iso_code) DO UPDATE SET currency = EXCLUDED.currency RETURNING id`,
    [],
  );
  state.ids.countryId = bi.id;
  state.ids.complete = await seedSchool(bi.id, "CPL");
  state.ids.other = await seedSchool(bi.id, "OTH");
});

after(async () => {
  if (state.pool) await state.pool.end().catch(() => undefined);
  if (state.repo && typeof state.repo.close === "function") await state.repo.close().catch(() => undefined);
  if (state.repo?.pool && typeof state.repo.pool.end === "function") await state.repo.pool.end().catch(() => undefined);
  if (!state.name || !WORK_NAME.test(state.name)) return;
  const admin = guardPgPool(new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres"), max: 1 }));
  try {
    await waitForNoDatabaseSessions(admin, state.name);
    await admin.query(`DROP DATABASE ${state.name} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
});

async function snapshotOf(schoolId) {
  return loadSchoolSetupGuidedSnapshot(one, schoolId);
}

function satisfiedSteps(snapshot) {
  return GUIDED_STEP_KEYS.filter((key) => stepSatisfied(key, snapshot));
}

test("AUDIT10-PG-00 — établissement complet : les 10 étapes sont satisfaites sur données PostgreSQL réelles", async () => {
  const snapshot = await snapshotOf(state.ids.complete.schoolId);
  assert.deepEqual(satisfiedSteps(snapshot), [...GUIDED_STEP_KEYS]);
});

test("AUDIT10-PG-01 — anomalie prod : adresse vide → seule l'adresse est signalée manquante", async () => {
  const { schoolId } = await seedSchool(state.ids.countryId, "NOADR", { address: "" });
  const snapshot = await snapshotOf(schoolId);
  assert.equal(stepSatisfied("establishment", snapshot), false);
  assert.equal(snapshot.hasName, true);
  assert.equal(snapshot.hasCountry, true);
  assert.equal(snapshot.hasPhone, true);
  assert.equal(snapshot.hasCurrency, true, "la devise du pays (BIF) est une devise valide");
  assert.equal(snapshot.hasAddress, false);
});

test("AUDIT10-PG-02 — devise : `currency: \"\"` dans profile_payload ne masque pas la devise du pays (lecture canonique)", async () => {
  const { schoolId } = await seedSchool(state.ids.countryId, "CUREMPTY", { payload: { currency: "" } });
  const row = await one(
    `SELECT s.*, c.name AS country_name, c.iso_code, c.currency AS country_currency
     FROM schools s JOIN countries c ON c.id = s.country_id WHERE s.id = $1`,
    [schoolId],
  );
  assert.equal(mapEstablishmentRow(row).currency, "BIF", "l'API profil présente la devise du pays");
  const snapshot = await snapshotOf(schoolId);
  assert.equal(snapshot.hasCurrency, true, "l'assistant doit lire la même devise que l'API profil");
  assert.equal(stepSatisfied("establishment", snapshot), true);
});

test("AUDIT10-PG-03 — adresse/téléphone historiques dans profile_payload : l'assistant lit la valeur présentée par l'API", async () => {
  const { schoolId } = await seedSchool(state.ids.countryId, "LEGACY", {
    address: "",
    phone: "",
    payload: { address: "Rohero, avenue historique", phone: "+25711111111" },
  });
  const row = await one(
    `SELECT s.*, c.name AS country_name, c.iso_code, c.currency AS country_currency
     FROM schools s JOIN countries c ON c.id = s.country_id WHERE s.id = $1`,
    [schoolId],
  );
  const presented = mapEstablishmentRow(row);
  assert.equal(presented.address, "Rohero, avenue historique");
  assert.equal(presented.phone, "+25711111111");
  const snapshot = await snapshotOf(schoolId);
  assert.equal(snapshot.hasAddress, true);
  assert.equal(snapshot.hasPhone, true);
});

test("AUDIT10-PG-04 — matière archivée : l'étape 4 n'est plus satisfaite", async () => {
  const fixture = await seedSchool(state.ids.countryId, "SUBARC");
  await state.pool.query(`UPDATE subjects SET status = 'archived' WHERE id = $1`, [fixture.subjectId]);
  const snapshot = await snapshotOf(fixture.schoolId);
  assert.equal(stepSatisfied("subjects", snapshot), false);
});

test("AUDIT10-PG-05 — enseignant archivé (affectation encore active) : l'étape 5 n'est plus satisfaite", async () => {
  const fixture = await seedSchool(state.ids.countryId, "TCHARC");
  await state.pool.query(`UPDATE teachers SET status = 'archived' WHERE id = $1`, [fixture.teacherId]);
  const snapshot = await snapshotOf(fixture.schoolId);
  assert.equal(stepSatisfied("teachers", snapshot), false);
});

test("AUDIT10-PG-06 — inscription retirée (WITHDRAWN) : l'étape 6 n'est plus satisfaite", async () => {
  const fixture = await seedSchool(state.ids.countryId, "ENRWD");
  await state.pool.query(`UPDATE enrollments SET status = 'WITHDRAWN' WHERE student_id = $1`, [fixture.studentId]);
  const snapshot = await snapshotOf(fixture.schoolId);
  assert.equal(stepSatisfied("students", snapshot), false);
});

test("AUDIT10-PG-06b — inscription `active` (minuscule) reste une inscription valide", async () => {
  const fixture = await seedSchool(state.ids.countryId, "ENRACT");
  await state.pool.query(`UPDATE enrollments SET status = 'active' WHERE student_id = $1`, [fixture.studentId]);
  const snapshot = await snapshotOf(fixture.schoolId);
  assert.equal(stepSatisfied("students", snapshot), true);
});

test("AUDIT10-PG-08 — type d'évaluation archivé : l'étape 8 n'est plus satisfaite", async () => {
  const fixture = await seedSchool(state.ids.countryId, "EVARC");
  await state.pool.query(`UPDATE evaluation_types SET status = 'archived' WHERE school_id = $1`, [fixture.schoolId]);
  const snapshot = await snapshotOf(fixture.schoolId);
  assert.equal(stepSatisfied("pedagogy", snapshot), false);
});

test("AUDIT10-PG-10 — utilisateur archivé seul : l'étape 10 n'est plus satisfaite", async () => {
  const fixture = await seedSchool(state.ids.countryId, "USRARC");
  await state.pool.query(`UPDATE users SET status = 'archived' WHERE id = $1`, [fixture.userId]);
  const snapshot = await snapshotOf(fixture.schoolId);
  assert.equal(stepSatisfied("users", snapshot), false);
});

test("AUDIT10-PG-ISO — isolation : les données d'un autre établissement ne satisfont aucune étape", async () => {
  const { schoolId } = await seedSchool(state.ids.countryId, "EMPTY");
  // On vide entièrement l'établissement EMPTY ; l'établissement OTH reste complet.
  for (const sql of [
    `DELETE FROM enrollments WHERE school_id = $1`,
    `DELETE FROM teacher_assignments WHERE school_id = $1`,
    `DELETE FROM evaluation_types WHERE school_id = $1`,
    `DELETE FROM school_notification_settings WHERE school_id = $1`,
    `DELETE FROM school_payment_methods WHERE school_id = $1`,
    `DELETE FROM fee_grids WHERE school_id = $1`,
    `DELETE FROM students WHERE school_id = $1`,
    `DELETE FROM teachers WHERE school_id = $1`,
    `DELETE FROM subjects WHERE school_id = $1`,
    `DELETE FROM users WHERE school_id = $1`,
  ]) {
    await state.pool.query(sql, [schoolId]);
  }
  const snapshot = await snapshotOf(schoolId);
  assert.deepEqual(
    satisfiedSteps(snapshot),
    ["establishment", "academicYear", "structure"],
    "seules les étapes réellement présentes dans cet établissement",
  );
  const other = await snapshotOf(state.ids.other.schoolId);
  assert.deepEqual(satisfiedSteps(other), [...GUIDED_STEP_KEYS]);
});
