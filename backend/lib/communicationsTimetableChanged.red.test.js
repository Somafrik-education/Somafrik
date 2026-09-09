"use strict";

/**
 * Lot L4 GREEN — TIMETABLE_CHANGED outbox C4.
 * Contrats RED-TT-01 → 16 : producteur planning.timetable.changed sur SoT
 * `course_schedule_weekly_slots` (Planning V2 hebdomadaire, status active).
 *
 * RED initial (base develop@25c3d836 sans L4) :
 * une UPDATE réelle d'un créneau actif ne produisait aucun event C4 TIMETABLE_CHANGED.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const { createMemoryDeliveryAdapter } = require("./communicationChannelFanout");
const { dispatchCommunication } = require("./communicationsDispatcher");
const { drainOutbox } = require("./communicationsNotificationsService");
const { mapDispatcherEventToLotI, LOT_I_EVENTS } = require("./schoolNotificationPolicy");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");

const ROOT = path.resolve(__dirname, "../..");
const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const TT_EVENT = "planning.timetable.changed";
const SCHOOL_A = "a8000000-0000-4000-8000-000000000001";
const SCHOOL_B = "b8000000-0000-4000-8000-000000000002";
const ADMIN_A = "a8000000-0000-4000-8000-000000000010";
const ADMIN_B = "b8000000-0000-4000-8000-000000000011";
const TEACHER_USER_A = "a8000000-0000-4000-8000-000000000012";
const TEACHER_USER_B = "a8000000-0000-4000-8000-000000000013";
const TEACHER_USER_OTHER = "b8000000-0000-4000-8000-000000000012";
const TEACHER_A = "a8000000-0000-4000-8000-000000000020";
const TEACHER_B = "a8000000-0000-4000-8000-000000000021";
const TEACHER_OTHER = "b8000000-0000-4000-8000-000000000022";
const CLASS_A = "a8000000-0000-4000-8000-000000000030";
const CLASS_B = "a8000000-0000-4000-8000-000000000031";
const CLASS_OTHER = "b8000000-0000-4000-8000-000000000030";
const YEAR_A = "a8000000-0000-4000-8000-000000000040";
const YEAR_B = "b8000000-0000-4000-8000-000000000041";
const SUBJECT_A = "a8000000-0000-4000-8000-000000000050";
const SUBJECT_B = "a8000000-0000-4000-8000-000000000051";
const SUBJECT_OTHER = "b8000000-0000-4000-8000-000000000050";
const COURSE_A = "a8000000-0000-4000-8000-000000000060";
const COURSE_B = "a8000000-0000-4000-8000-000000000061";
const COURSE_OTHER = "b8000000-0000-4000-8000-000000000060";
const SLOT_A = "a8000000-0000-4000-8000-000000000070";
const SLOT_B = "a8000000-0000-4000-8000-000000000071";
const SLOT_OTHER = "b8000000-0000-4000-8000-000000000070";
const NOTE_ID = "d8000000-0000-4000-8000-000000000001";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function requirePolicy() {
  return require("./schoolNotificationPolicy");
}

function defaultPolicyWith(overrides = {}) {
  const policy = requirePolicy();
  const defaults = policy.getDefaultSchoolNotificationSettings();
  const events = { ...defaults.events };
  for (const [event, recipients] of Object.entries(overrides)) {
    events[event] = {
      ...events[event],
      ...Object.fromEntries(
        Object.entries(recipients).map(([recipient, channels]) => [
          recipient,
          { ...events[event]?.[recipient], ...channels },
        ]),
      ),
    };
  }
  return { events };
}

function envPreprod() {
  return {
    NODE_ENV: "test",
    APP_ENV: "preproduction",
    SMTP_HOST: "smtp.test.local",
    MAIL_FROM: "noreply@somafrik.app",
  };
}

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function withIsolatedPg(run) {
  if (!DATABASE_URL) {
    return { skipped: true };
  }
  const dbName = `somafrik_tt_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

async function seedTimetableFixtures(pool) {
  const countryA = (await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('TT A','CI','+225','XOF') RETURNING id`,
  )).rows[0].id;
  const countryB = (await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('TT B','FR','+33','EUR') RETURNING id`,
  )).rows[0].id;
  await pool.query(
    `INSERT INTO schools (id, country_id, school_code, name, status) VALUES
      ($1,$3,'SCH-TT-A','TT A','active'),($2,$4,'SCH-TT-B','TT B','active')`,
    [SCHOOL_A, SCHOOL_B, countryA, countryB],
  );
  await pool.query(
    `INSERT INTO users (id,school_id,user_code,first_name,last_name,email,role,status) VALUES
      ($1,$6,'ADM-TT-A','Admin','A','adm-tt-a@test.local','Admin School','active'),
      ($2,$7,'ADM-TT-B','Admin','B','adm-tt-b@test.local','Admin School','active'),
      ($3,$6,'ENS-TT-A','Teacher','A','ens-tt-a@test.local','Teacher','active'),
      ($4,$6,'ENS-TT-B','Teacher','B','ens-tt-b@test.local','Teacher','active'),
      ($5,$7,'ENS-TT-OTHER','Teacher','Other','ens-other-tt@test.local','Teacher','active')`,
    [ADMIN_A, ADMIN_B, TEACHER_USER_A, TEACHER_USER_B, TEACHER_USER_OTHER, SCHOOL_A, SCHOOL_B],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES
      ($1,$3,'SCHOOL_ADMIN','active'),($2,$4,'SCHOOL_ADMIN','active')`,
    [ADMIN_A, ADMIN_B, SCHOOL_A, SCHOOL_B],
  );
  await pool.query(
    `INSERT INTO academic_years (id,school_id,name,status) VALUES ($1,$3,'2025-2026','open'),($2,$4,'2025-2026','open')`,
    [YEAR_A, YEAR_B, SCHOOL_A, SCHOOL_B],
  );
  await pool.query(
    `INSERT INTO classes (id,school_id,academic_year_id,class_code,name,status) VALUES
      ($1,$4,$6,'CLS-A','6A','active'),($2,$4,$6,'CLS-B','6B','active'),($3,$5,$7,'CLS-OTHER','6A','active')`,
    [CLASS_A, CLASS_B, CLASS_OTHER, SCHOOL_A, SCHOOL_B, YEAR_A, YEAR_B],
  );
  await pool.query(
    `INSERT INTO subjects (id,school_id,subject_code,name,coefficient,status) VALUES
      ($1,$4,'SUB-A','Maths',2,'active'),($2,$4,'SUB-B','Français',2,'active'),($3,$5,'SUB-OTHER','Maths',2,'active')`,
    [SUBJECT_A, SUBJECT_B, SUBJECT_OTHER, SCHOOL_A, SCHOOL_B],
  );
  await pool.query(
    `INSERT INTO teachers (id,school_id,user_id,teacher_code,status) VALUES
      ($1,$4,$6,'ENS-A','active'),($2,$4,$7,'ENS-B','active'),($3,$5,$8,'ENS-OTHER','active')`,
    [TEACHER_A, TEACHER_B, TEACHER_OTHER, SCHOOL_A, SCHOOL_B, TEACHER_USER_A, TEACHER_USER_B, TEACHER_USER_OTHER],
  );
  await pool.query(
    `INSERT INTO school_courses (id,school_id,class_id,subject_id,teacher_id,course_code,coefficient,status) VALUES
      ($1,$4,$6,$9,$12,'COURSE-A',2,'active'),
      ($2,$4,$7,$10,$13,'COURSE-B',2,'active'),
      ($3,$5,$8,$11,$14,'COURSE-OTHER',2,'active')`,
    [COURSE_A, COURSE_B, COURSE_OTHER, SCHOOL_A, SCHOOL_B, CLASS_A, CLASS_B, CLASS_OTHER, SUBJECT_A, SUBJECT_B, SUBJECT_OTHER, TEACHER_A, TEACHER_B, TEACHER_OTHER],
  );
}

async function insertWeeklySlot(pool, {
  id = randomUUID(),
  schoolId = SCHOOL_A,
  yearId = YEAR_A,
  courseId = COURSE_A,
  classId = CLASS_A,
  teacherId = TEACHER_A,
  dayOfWeek = 1,
  startTime = "08:00:00",
  endTime = "09:00:00",
  status = "active",
  room = "Salle 1",
}) {
  await pool.query(
    `INSERT INTO course_schedule_weekly_slots
       (id, school_id, academic_year_id, school_course_id, class_id, teacher_id,
        day_of_week, start_time, end_time, status, room)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::time,$9::time,$10,$11)`,
    [id, schoolId, yearId, courseId, classId, teacherId, dayOfWeek, startTime, endTime, status, room],
  );
  return id;
}

async function patchWeeklySlot(pool, id, patch) {
  const row = (await pool.query(`SELECT * FROM course_schedule_weekly_slots WHERE id = $1`, [id])).rows[0];
  const fmtTime = (value) => {
    if (value instanceof Date) {
      const pad = (n) => String(n).padStart(2, "0");
      return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
    }
    const raw = String(value ?? "").trim();
    return raw.length === 5 ? `${raw}:00` : raw;
  };
  await pool.query(
    `UPDATE course_schedule_weekly_slots
     SET day_of_week = $2,
         start_time = $3::time,
         end_time = $4::time,
         room = $5,
         teacher_id = $6,
         school_course_id = $7,
         class_id = $8,
         status = $9,
         updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      patch.dayOfWeek ?? row.day_of_week,
      fmtTime(patch.startTime ?? row.start_time),
      fmtTime(patch.endTime ?? row.end_time),
      patch.room ?? row.room,
      patch.teacherId ?? row.teacher_id,
      patch.schoolCourseId ?? row.school_course_id,
      patch.classId ?? row.class_id,
      patch.status ?? row.status,
    ],
  );
}

async function outboxForSlot(pool, slotId) {
  return (await pool.query(
    `SELECT * FROM communication_event_outbox
     WHERE source_entity_id = $1 AND event_type = $2
     ORDER BY occurred_at, id`,
    [slotId, TT_EVENT],
  )).rows;
}

async function drainSlot(pool, slotId) {
  await withRepo(pool, async (repo) => {
    await drainOutbox(repo.getClientsStore(), { limit: 20 });
  });
  return outboxForSlot(pool, slotId);
}

function parseOutboxPayload(row) {
  const raw = row?.payload;
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

async function recipientsForEventKey(pool, eventKey) {
  const note = await pool.query(
    `SELECT id FROM communication_notifications WHERE event_key = $1`,
    [eventKey],
  );
  if (!note.rows.length) return [];
  const rec = await pool.query(
    `SELECT user_id FROM notification_recipients WHERE notification_id = $1`,
    [note.rows[0].id],
  );
  return rec.rows.map((row) => row.user_id);
}

test("RED-TT-03 — mapping dispatcher → TIMETABLE_CHANGED", () => {
  assert.equal(mapDispatcherEventToLotI(TT_EVENT), "TIMETABLE_CHANGED");
  assert.match(read("backend/lib/communicationsDispatcher.js"), /"planning\.timetable\.changed": \["PUSH", "EMAIL"\]/);
  assert.match(read("backend/lib/schoolNotificationPolicy.js"), /"planning\.timetable\.changed": "TIMETABLE_CHANGED"/);
});

test("RED-TT-01 — changement planning actif produit un event outbox", async () => {
  await withIsolatedPg(async (pool) => {
    await seedTimetableFixtures(pool);
    await insertWeeklySlot(pool, { id: SLOT_A });
    assert.equal((await outboxForSlot(pool, SLOT_A)).length, 0, "INSERT nouvelle séance → 0 event");
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:30:00" });
    const rows = await outboxForSlot(pool, SLOT_A);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_type, TT_EVENT);
    assert.equal(rows[0].school_id, SCHOOL_A);
  });
});

test("RED-TT-02 — UPDATE sans changement métier → 0 event", async () => {
  await withIsolatedPg(async (pool) => {
    await seedTimetableFixtures(pool);
    await insertWeeklySlot(pool, { id: SLOT_A });
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:30:00" });
    assert.equal((await outboxForSlot(pool, SLOT_A)).length, 1);
    await pool.query(
      `UPDATE course_schedule_weekly_slots SET updated_at = NOW() WHERE id = $1`,
      [SLOT_A],
    );
    assert.equal((await outboxForSlot(pool, SLOT_A)).length, 1);
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:30:00" });
    assert.equal((await outboxForSlot(pool, SLOT_A)).length, 1);
  });
});

test("RED-TT-04 — event key déterministe (change_revision monotone)", async () => {
  await withIsolatedPg(async (pool) => {
    await seedTimetableFixtures(pool);
    await insertWeeklySlot(pool, { id: SLOT_A });
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:30:00" });
    const row = (await outboxForSlot(pool, SLOT_A))[0];
    assert.match(row.event_key, /^planning\.timetable\.changed:[0-9a-f-]+:1$/);
    assert.equal(Number(row.payload.changeRevision), 1);
  });
});

test("RED-TT-05 — retry même modification → pas de doublon", async () => {
  await withIsolatedPg(async (pool) => {
    await seedTimetableFixtures(pool);
    await insertWeeklySlot(pool, { id: SLOT_A });
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:30:00" });
    const firstKey = (await outboxForSlot(pool, SLOT_A))[0].event_key;
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:30:00" });
    const rows = await outboxForSlot(pool, SLOT_A);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_key, firstKey);
  });
});

test("RED-TT-06 — deux modifications métier successives → deux événements", async () => {
  await withIsolatedPg(async (pool) => {
    await seedTimetableFixtures(pool);
    await insertWeeklySlot(pool, { id: SLOT_A });
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:30:00" });
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:45:00" });
    const rows = await outboxForSlot(pool, SLOT_A);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].event_key, rows[1].event_key);
  });
});

test("RED-TT-07 — créneau non actif modifié → 0 event", async () => {
  await withIsolatedPg(async (pool) => {
    await seedTimetableFixtures(pool);
    const archivedId = randomUUID();
    await insertWeeklySlot(pool, { id: archivedId, status: "archived" });
    await patchWeeklySlot(pool, archivedId, { startTime: "08:30:00" });
    assert.equal((await outboxForSlot(pool, archivedId)).length, 0);
  });
});

test("RED-TT-08/09 — enseignant classe concernée uniquement, autre classe exclue", async () => {
  await withIsolatedPg(async (pool) => {
    await seedTimetableFixtures(pool);
    await insertWeeklySlot(pool, { id: SLOT_A, classId: CLASS_A, courseId: COURSE_A, teacherId: TEACHER_A });
    await insertWeeklySlot(pool, {
      id: SLOT_B,
      classId: CLASS_B,
      courseId: COURSE_B,
      teacherId: TEACHER_B,
      dayOfWeek: 2,
      startTime: "10:00:00",
      endTime: "11:00:00",
    });
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:30:00" });
    await drainSlot(pool, SLOT_A);
    const teacherA = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE r.user_id = $1 AND n.event_type = $2`,
      [TEACHER_USER_A, TT_EVENT],
    );
    const teacherB = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE r.user_id = $1 AND n.event_type = $2`,
      [TEACHER_USER_B, TT_EVENT],
    );
    assert.equal(teacherA.rows[0].c, 1);
    assert.equal(teacherB.rows[0].c, 0);
  });
});

test("RED-TT-10 — autre tenant exclu", async () => {
  await withIsolatedPg(async (pool) => {
    await seedTimetableFixtures(pool);
    await insertWeeklySlot(pool, { id: SLOT_A });
    await insertWeeklySlot(pool, {
      id: SLOT_OTHER,
      schoolId: SCHOOL_B,
      yearId: YEAR_B,
      courseId: COURSE_OTHER,
      classId: CLASS_OTHER,
      teacherId: TEACHER_OTHER,
    });
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:30:00" });
    await drainSlot(pool, SLOT_A);
    const otherTeacher = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE r.user_id = $1 AND n.event_type = $2`,
      [TEACHER_USER_OTHER, TT_EVENT],
    );
    const otherAdmin = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE r.user_id = $1 AND n.event_type = $2`,
      [ADMIN_B, TT_EVENT],
    );
    assert.equal(otherTeacher.rows[0].c, 0);
    assert.equal(otherAdmin.rows[0].c, 0);
  });
});

test("RED-TT-11 — politique établissement TIMETABLE_CHANGED appliquée", async () => {
  const policy = requirePolicy();
  const offPush = policy.resolveAllowedChannels({
    event: "TIMETABLE_CHANGED",
    recipient: "TEACHER",
    schoolPolicy: defaultPolicyWith({ TIMETABLE_CHANGED: { TEACHER: { PUSH: false } } }).events,
    userPreferences: { IN_APP: true, PUSH: true, EMAIL: true },
  });
  assert.equal([...offPush].includes("PUSH"), false);
  assert.equal([...offPush].includes("EMAIL"), true);

  const eventKey = `${TT_EVENT}:policy-test`;
  const adapter = createMemoryDeliveryAdapter({
    notifications: [{
      id: NOTE_ID,
      event_key: eventKey,
      event_type: TT_EVENT,
      school_id: SCHOOL_A,
      title: "Emploi du temps modifié",
      body: "Une modification a été apportée à l'emploi du temps.",
    }],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: TEACHER_USER_A, recipient_kind: "teacher" }],
    users: [{ id: TEACHER_USER_A, school_id: SCHOOL_A, email: "ens-tt-a@test.local" }],
  });
  adapter.schoolNotificationPolicy = defaultPolicyWith({ TIMETABLE_CHANGED: { TEACHER: { EMAIL: false } } }).events;
  await dispatchCommunication({
    eventKey,
    eventType: TT_EVENT,
    schoolId: SCHOOL_A,
    channels: ["PUSH", "EMAIL"],
    adapter,
    pushStore: { async listActiveForUser() { return [{ expo_push_token: "ExponentPushToken[tt-a]" }]; } },
    pushClient: { async sendToTokens() { return { sent: 1 }; } },
    mailer: { async sendMail() { throw new Error("EMAIL établissement refusé"); } },
    env: envPreprod(),
  });
  assert.equal(adapter.deliveries.some((row) => row.channel === "EMAIL"), false);
  assert.equal(adapter.deliveries.some((row) => row.channel === "PUSH"), true);
});

test("RED-TT-12 — préférences utilisateur AND policy", async () => {
  const policy = requirePolicy();
  const onlyEmail = policy.resolveAllowedChannels({
    event: "TIMETABLE_CHANGED",
    recipient: "TEACHER",
    schoolPolicy: defaultPolicyWith().events,
    userPreferences: { IN_APP: true, PUSH: false, EMAIL: true },
  });
  assert.equal([...onlyEmail].includes("PUSH"), false);
  assert.equal([...onlyEmail].includes("EMAIL"), true);
});

test("RED-TT-13 — aucun legacy double-write", async () => {
  await withIsolatedPg(async (pool) => {
    await seedTimetableFixtures(pool);
    await insertWeeklySlot(pool, { id: SLOT_A });
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:30:00" });
    await drainSlot(pool, SLOT_A);
    const legacy = await pool.query(`SELECT count(*)::int c FROM notifications`);
    assert.equal(legacy.rows[0].c, 0);
  });
  assert.doesNotMatch(read("backend/lib/communicationsNotificationsService.js"), /INTO notifications /);
});

test("RED-TT-14 — plusieurs champs modifiés → 1 seul event", async () => {
  await withIsolatedPg(async (pool) => {
    await seedTimetableFixtures(pool);
    await insertWeeklySlot(pool, { id: SLOT_A });
    await patchWeeklySlot(pool, SLOT_A, {
      startTime: "09:00:00",
      endTime: "10:30:00",
      room: "Salle 2",
      dayOfWeek: 2,
    });
    assert.equal((await outboxForSlot(pool, SLOT_A)).length, 1);
  });
});

test("RED-TT-15 — changement weekly slot ne produit pas TEACHER_REPLACEMENT", async () => {
  await withIsolatedPg(async (pool) => {
    await seedTimetableFixtures(pool);
    await insertWeeklySlot(pool, { id: SLOT_A });
    await patchWeeklySlot(pool, SLOT_A, { teacherId: TEACHER_B, schoolCourseId: COURSE_B, classId: CLASS_B });
    const rows = await outboxForSlot(pool, SLOT_A);
    assert.equal(rows.length, 1);
    assert.equal(rows.every((row) => row.event_type === TT_EVENT), true);
    const replacement = await pool.query(
      `SELECT count(*)::int c FROM communication_event_outbox WHERE event_type = $1`,
      ["planning.teacher.replacement"],
    );
    assert.equal(replacement.rows[0].c, 0);
  });
});

test("RED-TT-17 — cycle A→B→A→B produit 3 événements distincts", async () => {
  await withIsolatedPg(async (pool) => {
    await seedTimetableFixtures(pool);
    await insertWeeklySlot(pool, { id: SLOT_A, startTime: "08:00:00", endTime: "09:00:00" });
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:30:00" });
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:00:00" });
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:30:00" });
    const rows = await outboxForSlot(pool, SLOT_A);
    assert.equal(rows.length, 3);
    assert.equal(new Set(rows.map((row) => row.event_key)).size, 3);
    assert.equal(rows[0].event_key, `${TT_EVENT}:${SLOT_A}:1`);
    assert.equal(rows[1].event_key, `${TT_EVENT}:${SLOT_A}:2`);
    assert.equal(rows[2].event_key, `${TT_EVENT}:${SLOT_A}:3`);
  });
});

test("RED-TT-18 — drain utilise snapshot payload, pas état courant du slot", async () => {
  await withIsolatedPg(async (pool) => {
    await seedTimetableFixtures(pool);
    await insertWeeklySlot(pool, { id: SLOT_A, teacherId: TEACHER_A, classId: CLASS_A, courseId: COURSE_A });
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:30:00" });
    await patchWeeklySlot(pool, SLOT_A, {
      teacherId: TEACHER_B,
      schoolCourseId: COURSE_B,
      classId: CLASS_B,
    });
    const rows = await outboxForSlot(pool, SLOT_A);
    assert.equal(rows.length, 2);
    const e1 = rows[0];
    const e2 = rows[1];
    const p1 = parseOutboxPayload(e1);
    const p2 = parseOutboxPayload(e2);
    assert.equal(String(p1.teacherId), TEACHER_A);
    assert.equal(String(p2.teacherId), TEACHER_B);
    assert.equal(String(p2.previousTeacherId), TEACHER_A);
    await drainSlot(pool, SLOT_A);
    const r1 = await recipientsForEventKey(pool, e1.event_key);
    const r2 = await recipientsForEventKey(pool, e2.event_key);
    assert.ok(r1.includes(TEACHER_USER_A), "E1 notifie enseignant A du snapshot");
    assert.equal(r1.includes(TEACHER_USER_B), false, "E1 n'utilise pas l'état courant (B)");
    assert.ok(r2.includes(TEACHER_USER_B), "E2 notifie nouvel enseignant B");
    assert.ok(r2.includes(TEACHER_USER_A), "E2 notifie aussi ancien enseignant A (changement prof)");
  });
});

test("RED-TT-19 — boot canonique sans migrations L4 manuelles", async () => {
  await withIsolatedPg(async (pool) => {
    const column = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'course_schedule_weekly_slots'
         AND column_name = 'change_revision'
       LIMIT 1`,
    );
    assert.equal(column.rowCount, 1, "change_revision présent après pedagogy + bootstrap C4");
    const bump = await pool.query(
      `SELECT 1 FROM pg_trigger WHERE tgname = 'trg_course_schedule_weekly_slots_bump_revision' LIMIT 1`,
    );
    assert.equal(bump.rowCount, 1, "trigger bump revision installé par bootstrap Pédagogie");
    const outboxTrigger = await pool.query(
      `SELECT 1 FROM pg_trigger WHERE tgname = 'trg_c4_timetable_changed_event' LIMIT 1`,
    );
    assert.equal(outboxTrigger.rowCount, 1, "trigger outbox C4 installé par bootstrap");
    await seedTimetableFixtures(pool);
    await insertWeeklySlot(pool, { id: SLOT_A, startTime: "08:00:00", endTime: "09:00:00" });
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:30:00" });
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:00:00" });
    await patchWeeklySlot(pool, SLOT_A, { startTime: "08:30:00" });
    const rows = await outboxForSlot(pool, SLOT_A);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].event_key, `${TT_EVENT}:${SLOT_A}:1`);
    assert.equal(rows[1].event_key, `${TT_EVENT}:${SLOT_A}:2`);
    assert.equal(rows[2].event_key, `${TT_EVENT}:${SLOT_A}:3`);
  });
});

test("RED-TT-16 — AUDIT-COM-FINAL matrice 9/9", () => {
  const schema = read("backend/db/communicationsNotificationsSchema.js");
  const teacherOutbox = read("backend/db/teacherReplacementOutbox.sql");
  const block = schema.slice(schema.indexOf("somafrik_enqueue_communication_event"), schema.indexOf("$$ LANGUAGE plpgsql"));
  const wired = [...new Set([...block.matchAll(/v_event_type := '([^']+)'/g)].map((m) => m[1]))];
  wired.push(...[...teacherOutbox.matchAll(/v_event_type(?:\s+TEXT)?\s*:=\s*'([^']+)'/g)].map((m) => m[1]));
  const sweep = read("backend/lib/communicationsPaymentDueSweep.js");
  wired.push(...[...sweep.matchAll(/PD_EVENT = "([^"]+)"/g)].map((m) => m[1]));
  const mapped = [...new Set(wired)].map((t) => mapDispatcherEventToLotI(t)).filter(Boolean).sort();
  assert.equal(mapped.length, 9);
  assert.deepEqual(LOT_I_EVENTS.filter((key) => !mapped.includes(key)).sort(), []);
});
