"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const { STUDENT_ACCESS_CARDS_SCHEMA_SQL } = require("../db/studentAccessCardsSchema");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_STUDENT_ACCESS_CARDS_IT_DATABASE ?? "somafrik_student_access_cards_it")
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

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

async function expectReject(fn, code, label) {
  try {
    await fn();
  } catch (error) {
    assert.equal(error.code, code, `${label}: attendu ${code}, reçu ${error.code} (${error.message})`);
    return;
  }
  assert.fail(`${label}: aurait dû être rejeté (${code})`);
}

async function insertCard(pool, row) {
  return pool.query(
    `INSERT INTO student_access_cards (
       school_id, student_id, public_id, token_hash, medium, status,
       issued_at, revoked_at, revoke_reason, replaced_by_card_id, created_by_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, NOW()), $8, $9, $10, $11)
     RETURNING id`,
    [
      row.school_id,
      row.student_id,
      row.public_id,
      row.token_hash,
      row.medium,
      row.status,
      row.issued_at ?? null,
      row.revoked_at ?? null,
      row.revoke_reason ?? null,
      row.replaced_by_card_id ?? null,
      row.created_by_user_id ?? null,
    ],
  );
}

async function main() {
  if (!DATABASE_URL) {
    console.log("studentAccessCards.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await pool.query(`
      CREATE TABLE countries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        iso_code VARCHAR(8) NOT NULL UNIQUE
      );
      CREATE TABLE schools (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        country_id UUID NOT NULL REFERENCES countries(id),
        school_code VARCHAR(32) NOT NULL UNIQUE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id),
        user_code VARCHAR(64) NOT NULL UNIQUE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE students (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id),
        student_code VARCHAR(64) NOT NULL UNIQUE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE academic_years (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id),
        name TEXT NOT NULL,
        is_current BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL DEFAULT 'open'
      );
      CREATE TABLE classes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id),
        academic_year_id UUID NOT NULL REFERENCES academic_years(id),
        class_code VARCHAR(64) NOT NULL UNIQUE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE enrollments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id),
        student_id UUID NOT NULL REFERENCES students(id),
        class_id UUID REFERENCES classes(id),
        academic_year_id UUID NOT NULL REFERENCES academic_years(id),
        status TEXT NOT NULL DEFAULT 'ENROLLED',
        UNIQUE (student_id, academic_year_id)
      );
      CREATE TABLE school_settings (
        school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
        period_mode TEXT NOT NULL DEFAULT 'trimestre',
        student_card_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        student_card_qr_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        student_card_nfc_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        student_card_attendance_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        student_card_finance_check_enabled BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE TABLE attendance (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id),
        student_id UUID NOT NULL REFERENCES students(id),
        class_id UUID NOT NULL REFERENCES classes(id),
        attendance_date DATE NOT NULL,
        status TEXT NOT NULL,
        UNIQUE (school_id, student_id, attendance_date)
      );
    `);

    await pool.query(STUDENT_ACCESS_CARDS_SCHEMA_SQL);

    const country = (await pool.query(`INSERT INTO countries (name, iso_code) VALUES ('RDC', 'CD') RETURNING id`))
      .rows[0];
    const schoolA = (
      await pool.query(
        `INSERT INTO schools (country_id, school_code, name) VALUES ($1, 'SCH-A', 'École A') RETURNING id`,
        [country.id],
      )
    ).rows[0];
    const schoolB = (
      await pool.query(
        `INSERT INTO schools (country_id, school_code, name) VALUES ($1, 'SCH-B', 'École B') RETURNING id`,
        [country.id],
      )
    ).rows[0];
    const userA = (
      await pool.query(
        `INSERT INTO users (school_id, user_code, first_name, last_name)
         VALUES ($1, 'USR-A', 'Admin', 'A') RETURNING id`,
        [schoolA.id],
      )
    ).rows[0];
    const studentA = (
      await pool.query(
        `INSERT INTO students (school_id, student_code, first_name, last_name)
         VALUES ($1, 'STU-A', 'Amina', 'K') RETURNING id`,
        [schoolA.id],
      )
    ).rows[0];
    const studentA2 = (
      await pool.query(
        `INSERT INTO students (school_id, student_code, first_name, last_name)
         VALUES ($1, 'STU-A2', 'Binta', 'K') RETURNING id`,
        [schoolA.id],
      )
    ).rows[0];
    const studentB = (
      await pool.query(
        `INSERT INTO students (school_id, student_code, first_name, last_name)
         VALUES ($1, 'STU-B', 'Chika', 'M') RETURNING id`,
        [schoolB.id],
      )
    ).rows[0];

    const table = await pool.query(`SELECT to_regclass('public.student_access_cards') AS ref`);
    assert.ok(table.rows[0].ref, "1. table student_access_cards créée");

    const forbidden = await pool.query(`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'student_access_cards'
         AND column_name IN (
           'token','secret','raw_token','qr_payload','nfc_uid',
           'first_name','last_name','parent_phone','parent_email',
           'birth_date','class_id','balance','debt','jwt'
         )
    `);
    assert.equal(forbidden.rowCount, 0, "aucune colonne métier / secret plaintext");

    await expectReject(
      () =>
        insertCard(pool, {
          school_id: crypto.randomUUID(),
          student_id: studentA.id,
          public_id: "pub-missing-school",
          token_hash: sha256Hex("missing-school"),
          medium: "qr",
          status: "active",
        }),
      "23503",
      "2. FK school invalide",
    );

    await expectReject(
      () =>
        insertCard(pool, {
          school_id: schoolA.id,
          student_id: crypto.randomUUID(),
          public_id: "pub-missing-student",
          token_hash: sha256Hex("missing-student"),
          medium: "qr",
          status: "active",
        }),
      "23503",
      "3. FK student invalide",
    );

    await expectReject(
      () =>
        insertCard(pool, {
          school_id: schoolA.id,
          student_id: studentB.id,
          public_id: "pub-cross-tenant",
          token_hash: sha256Hex("cross-tenant"),
          medium: "qr",
          status: "active",
        }),
      "23503",
      "4. school A + student B rejeté",
    );

    const firstActive = await insertCard(pool, {
      school_id: schoolA.id,
      student_id: studentA.id,
      public_id: "pub-active-1",
      token_hash: sha256Hex("active-1"),
      medium: "nfc_qr",
      status: "active",
      created_by_user_id: userA.id,
    });
    assert.equal(firstActive.rowCount, 1, "10. première carte active acceptée");

    await expectReject(
      () =>
        insertCard(pool, {
          school_id: schoolA.id,
          student_id: studentA.id,
          public_id: "pub-active-1",
          token_hash: sha256Hex("dup-public"),
          medium: "qr",
          status: "issued",
        }),
      "23505",
      "5. public_id unique",
    );

    await expectReject(
      () =>
        insertCard(pool, {
          school_id: schoolA.id,
          student_id: studentA2.id,
          public_id: "pub-dup-hash",
          token_hash: sha256Hex("active-1"),
          medium: "qr",
          status: "issued",
        }),
      "23505",
      "6. token_hash unique",
    );

    await expectReject(
      () =>
        insertCard(pool, {
          school_id: schoolA.id,
          student_id: studentA2.id,
          public_id: "pub-plain-token",
          token_hash: "not-a-sha256-hex",
          medium: "qr",
          status: "issued",
        }),
      "23514",
      "7. token_hash non SHA-256 hex",
    );

    await expectReject(
      () =>
        insertCard(pool, {
          school_id: schoolA.id,
          student_id: studentA2.id,
          public_id: "pub-upper-hash",
          token_hash: sha256Hex("upper").toUpperCase(),
          medium: "qr",
          status: "issued",
        }),
      "23514",
      "7b. token_hash hex majuscule rejeté",
    );

    await expectReject(
      () =>
        insertCard(pool, {
          school_id: schoolA.id,
          student_id: studentA2.id,
          public_id: "pub-bad-medium",
          token_hash: sha256Hex("bad-medium"),
          medium: "barcode",
          status: "issued",
        }),
      "23514",
      "8. medium inconnu",
    );

    await expectReject(
      () =>
        insertCard(pool, {
          school_id: schoolA.id,
          student_id: studentA2.id,
          public_id: "pub-bad-status",
          token_hash: sha256Hex("bad-status"),
          medium: "qr",
          status: "suspended",
        }),
      "23514",
      "9. status inconnu",
    );

    await expectReject(
      () =>
        insertCard(pool, {
          school_id: schoolA.id,
          student_id: studentA.id,
          public_id: "pub-active-2",
          token_hash: sha256Hex("active-2"),
          medium: "nfc",
          status: "active",
        }),
      "23505",
      "11. deuxième carte active même (school, student) refusée",
    );

    const lost = await insertCard(pool, {
      school_id: schoolA.id,
      student_id: studentA.id,
      public_id: "pub-lost-hist",
      token_hash: sha256Hex("lost-hist"),
      medium: "qr",
      status: "lost",
      revoked_at: new Date(),
      revoke_reason: "lost",
    });
    const revoked = await insertCard(pool, {
      school_id: schoolA.id,
      student_id: studentA.id,
      public_id: "pub-revoked-hist",
      token_hash: sha256Hex("revoked-hist"),
      medium: "nfc",
      status: "revoked",
      revoked_at: new Date(),
    });
    assert.equal(lost.rowCount, 1);
    assert.equal(revoked.rowCount, 1, "12. cartes historiques non actives acceptées");

    await expectReject(
      () =>
        insertCard(pool, {
          school_id: schoolB.id,
          student_id: studentA.id,
          public_id: "pub-same-student-other-tenant",
          token_hash: sha256Hex("other-tenant-student"),
          medium: "qr",
          status: "issued",
        }),
      "23503",
      "13. même étudiant impossible dans un autre tenant",
    );

    const replacementOtherStudent = await insertCard(pool, {
      school_id: schoolA.id,
      student_id: studentA2.id,
      public_id: "pub-other-student-card",
      token_hash: sha256Hex("other-student-card"),
      medium: "qr",
      status: "issued",
    });
    await expectReject(
      () =>
        insertCard(pool, {
          school_id: schoolA.id,
          student_id: studentA.id,
          public_id: "pub-replace-other-student",
          token_hash: sha256Hex("replace-other-student"),
          medium: "qr",
          status: "replaced",
          revoked_at: new Date(),
          replaced_by_card_id: replacementOtherStudent.rows[0].id,
        }),
      "23503",
      "14. remplacement vers autre étudiant refusé",
    );

    const otherSchoolCard = await insertCard(pool, {
      school_id: schoolB.id,
      student_id: studentB.id,
      public_id: "pub-school-b-card",
      token_hash: sha256Hex("school-b-card"),
      medium: "qr",
      status: "issued",
    });
    await expectReject(
      () =>
        insertCard(pool, {
          school_id: schoolA.id,
          student_id: studentA.id,
          public_id: "pub-replace-other-school",
          token_hash: sha256Hex("replace-other-school"),
          medium: "qr",
          status: "replaced",
          revoked_at: new Date(),
          replaced_by_card_id: otherSchoolCard.rows[0].id,
        }),
      "23503",
      "15. remplacement vers autre école refusé",
    );

    const validReplacement = await insertCard(pool, {
      school_id: schoolA.id,
      student_id: studentA.id,
      public_id: "pub-replacement-ok",
      token_hash: sha256Hex("replacement-ok"),
      medium: "nfc_qr",
      status: "issued",
    });
    const replaced = await insertCard(pool, {
      school_id: schoolA.id,
      student_id: studentA.id,
      public_id: "pub-replaced-ok",
      token_hash: sha256Hex("replaced-ok"),
      medium: "qr",
      status: "replaced",
      revoked_at: new Date(),
      replaced_by_card_id: validReplacement.rows[0].id,
    });
    assert.equal(replaced.rowCount, 1, "remplacement même élève / même école accepté");

    await expectReject(
      () =>
        insertCard(pool, {
          school_id: schoolA.id,
          student_id: studentA2.id,
          public_id: "pub-active-revoked-at",
          token_hash: sha256Hex("active-revoked-at"),
          medium: "qr",
          status: "active",
          revoked_at: new Date(),
        }),
      "23514",
      "16. active + revoked_at incohérent",
    );

    await expectReject(
      () =>
        insertCard(pool, {
          school_id: schoolA.id,
          student_id: studentA2.id,
          public_id: "pub-lost-no-revoked",
          token_hash: sha256Hex("lost-no-revoked"),
          medium: "qr",
          status: "lost",
        }),
      "23514",
      "16b. lost sans revoked_at",
    );

    await expectReject(
      () =>
        insertCard(pool, {
          school_id: schoolA.id,
          student_id: studentA2.id,
          public_id: "pub-replaced-no-ptr",
          token_hash: sha256Hex("replaced-no-ptr"),
          medium: "qr",
          status: "replaced",
          revoked_at: new Date(),
        }),
      "23514",
      "17. replaced sans replaced_by_card_id",
    );

    const year = (
      await pool.query(
        `INSERT INTO academic_years (school_id, name, is_current) VALUES ($1, '2026-2027', TRUE) RETURNING id`,
        [schoolA.id],
      )
    ).rows[0];
    const klass = (
      await pool.query(
        `INSERT INTO classes (school_id, academic_year_id, class_code, name)
         VALUES ($1, $2, 'CL-A', '6e A') RETURNING id`,
        [schoolA.id, year.id],
      )
    ).rows[0];
    const enrollment = await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [schoolA.id, studentA.id, klass.id, year.id],
    );
    const settings = await pool.query(
      `INSERT INTO school_settings (school_id) VALUES ($1) RETURNING student_card_enabled`,
      [schoolA.id],
    );
    const extraStudent = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name)
       VALUES ($1, 'STU-NEW', 'Dora', 'N') RETURNING id`,
      [schoolA.id],
    );
    const presence = await pool.query(
      `INSERT INTO attendance (school_id, student_id, class_id, attendance_date, status)
       VALUES ($1,$2,$3, CURRENT_DATE, 'present') RETURNING id`,
      [schoolA.id, studentA.id, klass.id],
    );
    assert.equal(enrollment.rowCount, 1);
    assert.equal(settings.rows[0].student_card_enabled, false);
    assert.equal(extraStudent.rowCount, 1);
    assert.equal(presence.rowCount, 1, "18. students / school_settings / enrollments / attendance inchangés");

    const idempotent = await pool.query(STUDENT_ACCESS_CARDS_SCHEMA_SQL);
    assert.ok(idempotent, "schéma idempotent");

    console.log("studentAccessCards.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
