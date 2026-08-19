"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { createPedagogyPgStore } = require("../db/pedagogyPgStore");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { PEDAGOGY_ERROR } = require("./pedagogyManagement");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_PLANNING_ROOMS_IT_DATABASE ?? "somafrik_planning_rooms_it")
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
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function seed(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  const schoolA = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status, profile_payload)
     VALUES ($1, 'CD-2026-0001', 'Lycée A', 'active', '{"timezone":"Africa/Kinshasa"}'::jsonb) RETURNING id`,
    [country.rows[0].id],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'BI-2026-0001', 'Lycée B', 'active') RETURNING id`,
    [country.rows[0].id],
  );
  const yearOpen = await pool.query(
    `INSERT INTO academic_years (school_id, name, status, start_date, end_date)
     VALUES ($1, '2026-2027', 'open', '2026-08-01', '2027-07-31') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const classA = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-2A', '2ème A', 'active') RETURNING id`,
    [schoolA.rows[0].id, yearOpen.rows[0].id],
  );
  const classB = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-2B', '2ème B', 'active') RETURNING id`,
    [schoolA.rows[0].id, yearOpen.rows[0].id],
  );
  const math = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
     VALUES ($1, 'SUB-MATH', 'Mathématiques', 2, 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const french = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
     VALUES ($1, 'SUB-FR', 'Français', 2, 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const sekeUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'USR-SEKE', 'Seke', 'Kilombo', 'seke@test.cd', 'TEACHER', 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const kabeyaUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'USR-KABEYA', 'Jean', 'Kabeya', 'kabeya@test.cd', 'TEACHER', 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const seke = await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, speciality, status)
     VALUES ($1, $2, 'ENS-SEKE', 'Mathématiques', 'active') RETURNING id`,
    [schoolA.rows[0].id, sekeUser.rows[0].id],
  );
  const kabeya = await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, speciality, status)
     VALUES ($1, $2, 'ENS-KABEYA', 'Français', 'active') RETURNING id`,
    [schoolA.rows[0].id, kabeyaUser.rows[0].id],
  );
  await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [schoolA.rows[0].id, seke.rows[0].id, classA.rows[0].id, math.rows[0].id, yearOpen.rows[0].id],
  );
  await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [schoolA.rows[0].id, kabeya.rows[0].id, classB.rows[0].id, french.rows[0].id, yearOpen.rows[0].id],
  );
  const adminUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'USR-ADMIN', 'Admin', 'School', 'admin@test.cd', 'SCHOOL_ADMIN', 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  return {
    schoolA: schoolA.rows[0].id,
    schoolB: schoolB.rows[0].id,
    yearOpen: yearOpen.rows[0].id,
    classA: classA.rows[0].id,
    classB: classB.rows[0].id,
    seke: seke.rows[0].id,
    kabeya: kabeya.rows[0].id,
    adminUser: adminUser.rows[0].id,
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("schoolRooms.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }
  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
    await pool.query(PEDAGOGY_SCHEMA_SQL);
    const fixture = await seed(pool);
    const repo = createPostgresRepository(isolatedUrl);
    repo.ready = true;
    const store = createPedagogyPgStore(repo);
    const admin = { role: "Admin School", schoolCode: "CD-2026-0001", sub: fixture.adminUser };
    const otherTenant = { role: "Admin School", schoolCode: "BI-2026-0001" };
    const auditMeta = { ipAddress: "127.0.0.1", userAgent: "rooms-it" };

    const a01 = await store.createSchoolRoom(
      { name: "Salle A01", capacity: 40, roomType: "Salle de classe", building: "Bloc A", floor: "RDC", equipment: "Tableau, projecteur" },
      admin,
      auditMeta,
    );
    assert.equal(a01.roomCode, "SAL-0001");
    assert.equal(a01.capacity, 40);
    const a02 = await store.createSchoolRoom({ name: "Salle A02", capacity: 30 }, admin, auditMeta);
    assert.equal(a02.roomCode, "SAL-0002");

    const listedB = await store.listSchoolRooms(otherTenant, { status: "all" });
    assert.equal(
      (listedB.items || []).some((row) => row.id === a01.id),
      false,
      "salle d'un autre établissement invisible",
    );

    const courseA = await store.createSchoolCourse(
      { className: "2ème A", name: "Mathématiques", teacherId: "ENS-SEKE" },
      admin,
      auditMeta,
    );
    const courseB = await store.createSchoolCourse(
      { className: "2ème B", name: "Français", teacherId: "ENS-KABEYA" },
      admin,
      auditMeta,
    );

    const slotA = await store.createCourseSchedule(
      {
        schoolCourseId: courseA.schoolCourseId,
        academicYearId: fixture.yearOpen,
        dayOfWeek: 1,
        startTime: "08:00",
        endTime: "09:00",
        roomId: a01.id,
      },
      admin,
      auditMeta,
    );
    assert.equal(slotA.roomId, a01.id);

    const overlap = await store
      .createCourseSchedule(
        {
          schoolCourseId: courseB.schoolCourseId,
          academicYearId: fixture.yearOpen,
          dayOfWeek: 1,
          startTime: "08:30",
          endTime: "09:30",
          roomId: a01.id,
        },
        admin,
        auditMeta,
      )
      .catch((error) => error);
    assert.equal(overlap.statusCode, 409);
    assert.equal(overlap.code, PEDAGOGY_ERROR.COURSE_SCHEDULE_CONFLICT);

    const adjacent = await store.createCourseSchedule(
      {
        schoolCourseId: courseB.schoolCourseId,
        academicYearId: fixture.yearOpen,
        dayOfWeek: 1,
        startTime: "09:00",
        endTime: "10:00",
        roomId: a01.id,
      },
      admin,
      auditMeta,
    );
    assert.ok(adjacent.id);
    assert.equal(adjacent.roomId, a01.id);

    const otherRoom = await store.createCourseSchedule(
      {
        schoolCourseId: courseB.schoolCourseId,
        academicYearId: fixture.yearOpen,
        dayOfWeek: 2,
        startTime: "08:00",
        endTime: "09:00",
        roomId: a02.id,
      },
      admin,
      auditMeta,
    );
    assert.equal(otherRoom.roomId, a02.id);

    await store.archiveSchoolRoom(a01.id, admin, auditMeta);
    const stillLinked = await pool.query(`SELECT room_id FROM course_schedule_weekly_slots WHERE id = $1`, [slotA.id]);
    assert.equal(stillLinked.rows[0].room_id, a01.id);
    const archived = await pool.query(`SELECT status FROM school_rooms WHERE id = $1`, [a01.id]);
    assert.equal(archived.rows[0].status, "archived");

    const audits = await pool.query(`SELECT action FROM audit_logs WHERE action LIKE 'ROOM_%' ORDER BY created_at`);
    assert.ok(audits.rows.some((row) => row.action === "ROOM_CREATE"));
    assert.ok(audits.rows.some((row) => row.action === "ROOM_ARCHIVE"));

    console.log("OK schoolRooms.pg.test.js: collision salle, adjacent OK, archive conserve historique");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
