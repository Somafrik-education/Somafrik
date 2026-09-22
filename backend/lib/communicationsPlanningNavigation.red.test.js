"use strict";

/**
 * Lot R2 (RED) — cible de navigation des producteurs planning.
 *
 * Contrat visé : une notification qui désigne une ressource ouvrable doit porter
 * une `navigation_target` exploitable, contenant l'identifiant de cette ressource
 * et le contexte minimal permettant de l'ouvrir.
 *
 * État actuel (develop@7bcca23a) : `eventSpec()` fixe explicitement
 *   navigationTarget = {}   (ligne 755 pour planning.timetable.changed)
 *   navigationTarget = {}   (ligne 818 pour planning.teacher.replacement)
 * alors que `metadata` contient déjà weeklySlotId, classId, replacementId et
 * occurrenceDate. Ces tests échouent donc aujourd'hui, par conception.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const { drainOutbox, list } = require("./communicationsNotificationsService");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { createPedagogyPgStore } = require("../db/pedagogyPgStore");

const ROOT = path.resolve(__dirname, "../..");
const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const TT_EVENT = "planning.timetable.changed";
const TR_EVENT = "planning.teacher.replacement";

const SCHOOL_A = "b1000000-0000-4000-8000-000000000001";
const ADMIN_A = "b1000000-0000-4000-8000-000000000010";
const TEACHER_USER_A = "b1000000-0000-4000-8000-000000000011";
const TEACHER_USER_B = "b1000000-0000-4000-8000-000000000012";
const PARENT_A = "b1000000-0000-4000-8000-000000000013";
const TEACHER_A = "b1000000-0000-4000-8000-000000000020";
const TEACHER_B = "b1000000-0000-4000-8000-000000000021";
const CLASS_A = "b1000000-0000-4000-8000-000000000030";
const YEAR_A = "b1000000-0000-4000-8000-000000000040";
const SUBJECT_A = "b1000000-0000-4000-8000-000000000050";
const COURSE_A = "b1000000-0000-4000-8000-000000000060";
const SLOT_A = "b1000000-0000-4000-8000-000000000070";
const STUDENT_A = "b1000000-0000-4000-8000-000000000080";
const OCCURRENCE = "2026-08-24";
const SCHOOL_CODE = "SCH-PLN-A";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function withIsolatedPg(run) {
  if (!DATABASE_URL) return { skipped: true };
  const dbName = `somafrik_pln_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const url = withDatabaseName(DATABASE_URL, dbName);
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(read("backend/db/schema.sql"));
    await pool.query(PEDAGOGY_SCHEMA_SQL);
    await ensureClientsCanonicalBootstrap(pool, { info() {}, error() {} });
    return { skipped: false, ...(await run(pool)) };
  } finally {
    await pool.end();
    const drop = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
    await drop.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await drop.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await drop.end();
  }
}

async function withRepo(pool, fn) {
  const { createPostgresRepository } = require("../db/repositoryFactory");
  const repo = createPostgresRepository(pool.options.connectionString);
  await repo.init();
  try {
    return await fn(repo);
  } finally {
    await repo.close();
  }
}

async function seedPlanningFixtures(pool) {
  const country = (await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('PLN','CI','+225','XOF') RETURNING id`,
  )).rows[0].id;
  await pool.query(
    `INSERT INTO schools (id, country_id, school_code, name, status) VALUES ($1,$2,$3,'Planning A','active')`,
    [SCHOOL_A, country, SCHOOL_CODE],
  );
  await pool.query(
    `INSERT INTO users (id,school_id,user_code,first_name,last_name,email,role,status) VALUES
      ($1,$5,'ADM-PLN','Admin','A','adm-pln@test.local','Admin School','active'),
      ($2,$5,'ENS-PLN-A','Teacher','A','ens-pln-a@test.local','Teacher','active'),
      ($3,$5,'ENS-PLN-B','Teacher','B','ens-pln-b@test.local','Teacher','active'),
      ($4,$5,'PAR-PLN-A','Parent','A','par-pln-a@test.local','Parent','active')`,
    [ADMIN_A, TEACHER_USER_A, TEACHER_USER_B, PARENT_A, SCHOOL_A],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1,$2,'SCHOOL_ADMIN','active')`,
    [ADMIN_A, SCHOOL_A],
  );
  await pool.query(
    `INSERT INTO academic_years (id,school_id,name,status,start_date,end_date)
     VALUES ($1,$2,'2026-2027','open','2026-08-01','2027-07-31')`,
    [YEAR_A, SCHOOL_A],
  );
  await pool.query(
    `INSERT INTO classes (id,school_id,academic_year_id,class_code,name,status) VALUES ($1,$2,$3,'CLS-A','6A','active')`,
    [CLASS_A, SCHOOL_A, YEAR_A],
  );
  await pool.query(
    `INSERT INTO subjects (id,school_id,subject_code,name,coefficient,status) VALUES ($1,$2,'SUB-A','Maths',2,'active')`,
    [SUBJECT_A, SCHOOL_A],
  );
  await pool.query(
    `INSERT INTO teachers (id,school_id,user_id,teacher_code,status) VALUES ($1,$3,$4,'ENS-A','active'),($2,$3,$5,'ENS-B','active')`,
    [TEACHER_A, TEACHER_B, SCHOOL_A, TEACHER_USER_A, TEACHER_USER_B],
  );
  await pool.query(
    `INSERT INTO school_courses (id,school_id,class_id,subject_id,teacher_id,course_code,coefficient,status)
     VALUES ($1,$2,$3,$4,$5,'COURSE-A',2,'active')`,
    [COURSE_A, SCHOOL_A, CLASS_A, SUBJECT_A, TEACHER_A],
  );
  await pool.query(
    `INSERT INTO course_schedule_weekly_slots
       (id, school_id, academic_year_id, school_course_id, class_id, teacher_id,
        day_of_week, start_time, end_time, status, room)
     VALUES ($1,$2,$3,$4,$5,$6,1,'08:00:00','09:00:00','active','Salle A')`,
    [SLOT_A, SCHOOL_A, YEAR_A, COURSE_A, CLASS_A, TEACHER_A],
  );
  await pool.query(
    `INSERT INTO students (id,school_id,student_code,first_name,last_name,status) VALUES ($1,$2,'STU-A','Eleve','A','active')`,
    [STUDENT_A, SCHOOL_A],
  );
  await pool.query(
    `INSERT INTO enrollments (school_id,student_id,class_id,academic_year_id,enrollment_date,status)
     VALUES ($1,$2,$3,$4,$5,'active')`,
    [SCHOOL_A, STUDENT_A, CLASS_A, YEAR_A, OCCURRENCE],
  );
  const contact = (await pool.query(
    `INSERT INTO contacts (school_id,country_id,first_name,last_name,contact_type,phone,status,user_id)
     VALUES ($1,$2,'Parent','A','Parent','+2250501','active',$3) RETURNING id`,
    [SCHOOL_A, country, PARENT_A],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO contact_relations (school_id,country_id,relation_type,contact_id,student_id,status)
     VALUES ($1,$2,'parent_student',$3,$4,'active')`,
    [SCHOOL_A, country, contact, STUDENT_A],
  );
}

function adminPrincipal() {
  return { role: "Admin School", schoolCode: SCHOOL_CODE, sub: ADMIN_A };
}

const auditMeta = { ipAddress: "127.0.0.1", userAgent: "planning-nav-red-test" };

async function drainAll(pool) {
  await withRepo(pool, async (repo) => {
    await drainOutbox(repo.getClientsStore(), { limit: 50 });
  });
}

function parseJson(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return {};
    }
  }
  return {};
}

async function notificationForEvent(pool, eventType) {
  const row = (await pool.query(
    `SELECT navigation_target, metadata, event_key, source_entity_id
     FROM communication_notifications
     WHERE event_type = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [eventType],
  )).rows[0];
  assert.ok(row, `aucune notification ${eventType} produite`);
  return {
    ...row,
    navigation_target: parseJson(row.navigation_target),
    metadata: parseJson(row.metadata),
  };
}

/** Cible telle qu'elle arrive réellement au client, via la projection API. */
async function navigationTargetSeenByClient(pool, userId, eventType) {
  return withRepo(pool, async (repo) => {
    const page = await list(repo.getClientsStore(), { sub: userId, schoolCode: SCHOOL_CODE, role: "Admin School" }, {});
    const item = page.items.find((row) => row.eventType === eventType);
    assert.ok(item, `notification ${eventType} absente de la liste API pour ${userId}`);
    return item.navigationTarget ?? {};
  });
}

async function mutateSlotStartTime(pool, startTime) {
  await pool.query(
    `UPDATE course_schedule_weekly_slots SET start_time = $2::time, updated_at = NOW() WHERE id = $1`,
    [SLOT_A, startTime],
  );
}

async function createReplacement(pool, substituteTeacherId) {
  return withRepo(pool, async (repo) => {
    const store = createPedagogyPgStore(repo);
    return store.createCourseScheduleReplacement(
      {
        weeklySlotId: SLOT_A,
        occurrenceDate: OCCURRENCE,
        substituteTeacherId,
        reason: "Absence",
      },
      adminPrincipal(),
      auditMeta,
    );
  });
}

test("RED-N4-TT-01 — planning.timetable.changed produit une cible de navigation non vide", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPlanningFixtures(pool);
    await mutateSlotStartTime(pool, "08:30:00");
    await drainAll(pool);

    const note = await notificationForEvent(pool, TT_EVENT);
    assert.notDeepEqual(
      note.navigation_target,
      {},
      "navigation_target vide : la notification emploi du temps n'est pas ouvrable",
    );
  });
});

test("RED-N4-TT-02 — la cible emploi du temps porte weeklySlotId et le contexte planning", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPlanningFixtures(pool);
    await mutateSlotStartTime(pool, "08:30:00");
    await drainAll(pool);

    const note = await notificationForEvent(pool, TT_EVENT);
    const target = note.navigation_target;
    assert.equal(String(target.type ?? ""), "timetable", "type de cible attendu « timetable »");
    assert.equal(String(target.weeklySlotId ?? ""), SLOT_A, "weeklySlotId absent de la cible");
    assert.equal(String(target.classId ?? ""), CLASS_A, "classId absent de la cible");
    // Les données requises sont déjà disponibles côté producteur.
    assert.equal(String(note.metadata.weeklySlotId ?? ""), SLOT_A, "metadata porte déjà le weeklySlotId");
  });
});

test("RED-N4-TT-03 — la cible emploi du temps traverse la projection API jusqu'au client", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPlanningFixtures(pool);
    await mutateSlotStartTime(pool, "08:30:00");
    await drainAll(pool);

    const target = await navigationTargetSeenByClient(pool, ADMIN_A, TT_EVENT);
    assert.equal(String(target.weeklySlotId ?? ""), SLOT_A, "le client ne reçoit pas le weeklySlotId");
  });
});

test("RED-N4-TR-01 — planning.teacher.replacement produit une cible de navigation non vide", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPlanningFixtures(pool);
    await createReplacement(pool, TEACHER_B);
    await drainAll(pool);

    const note = await notificationForEvent(pool, TR_EVENT);
    assert.notDeepEqual(
      note.navigation_target,
      {},
      "navigation_target vide : la notification de remplacement n'est pas ouvrable",
    );
  });
});

test("RED-N4-TR-02 — la cible remplacement porte replacementId, contexte classe et date d'occurrence", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPlanningFixtures(pool);
    const created = await createReplacement(pool, TEACHER_B);
    await drainAll(pool);

    const note = await notificationForEvent(pool, TR_EVENT);
    const target = note.navigation_target;
    assert.equal(String(target.type ?? ""), "teacher_replacement", "type de cible attendu « teacher_replacement »");
    assert.equal(String(target.replacementId ?? ""), String(created.id), "replacementId absent de la cible");
    assert.equal(String(target.classId ?? ""), CLASS_A, "classId absent de la cible");
    assert.equal(String(target.occurrenceDate ?? "").slice(0, 10), OCCURRENCE, "occurrenceDate absente de la cible");
    assert.equal(String(note.metadata.replacementId ?? ""), String(created.id), "metadata porte déjà le replacementId");
  });
});

test("RED-N4-TR-03 — la cible remplacement traverse la projection API jusqu'au client", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPlanningFixtures(pool);
    const created = await createReplacement(pool, TEACHER_B);
    await drainAll(pool);

    const target = await navigationTargetSeenByClient(pool, ADMIN_A, TR_EVENT);
    assert.equal(String(target.replacementId ?? ""), String(created.id), "le client ne reçoit pas le replacementId");
  });
});

test("RED-N4-SEPARATION — les deux producteurs planning gardent des cibles distinctes", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPlanningFixtures(pool);
    await mutateSlotStartTime(pool, "08:30:00");
    await createReplacement(pool, TEACHER_B);
    await drainAll(pool);

    const timetable = (await notificationForEvent(pool, TT_EVENT)).navigation_target;
    const replacement = (await notificationForEvent(pool, TR_EVENT)).navigation_target;
    assert.notDeepEqual(timetable, {}, "cible emploi du temps vide");
    assert.notDeepEqual(replacement, {}, "cible remplacement vide");
    assert.notEqual(
      String(timetable.type ?? ""),
      String(replacement.type ?? ""),
      "les deux évènements planning ne doivent pas partager le même type de cible",
    );
  });
});
