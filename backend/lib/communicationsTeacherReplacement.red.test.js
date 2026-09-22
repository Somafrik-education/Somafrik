"use strict";

/**
 * Lot L5 GREEN — TEACHER_REPLACEMENT outbox C4.
 * Contrats RED-TR-01 → 27 + RED-TR-BOOT : producteur planning.teacher.replacement
 * sur SoT `course_schedule_replacements` (ponctuel par occurrence datée).
 *
 * RED initial (base develop@0c79ed40 sans L5) :
 * createCourseScheduleReplacement(...) → remplacement PG créé → 0 event C4 TEACHER_REPLACEMENT.
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
const { createPedagogyPgStore } = require("../db/pedagogyPgStore");

const ROOT = path.resolve(__dirname, "../..");
const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const TR_EVENT = "planning.teacher.replacement";
const TT_EVENT = "planning.timetable.changed";
const SCHOOL_A = "e8000000-0000-4000-8000-000000000001";
const SCHOOL_B = "e8000000-0000-4000-8000-000000000002";
const ADMIN_A = "e8000000-0000-4000-8000-000000000010";
const ADMIN_B = "e8000000-0000-4000-8000-000000000011";
const TEACHER_USER_A = "e8000000-0000-4000-8000-000000000012";
const TEACHER_USER_B = "e8000000-0000-4000-8000-000000000013";
const TEACHER_USER_C = "e8000000-0000-4000-8000-000000000014";
const TEACHER_USER_D = "e8000000-0000-4000-8000-000000000015";
const TEACHER_USER_OTHER = "e8000000-0000-4000-8000-000000000016";
const PARENT_A = "e8000000-0000-4000-8000-000000000020";
const PARENT_B = "e8000000-0000-4000-8000-000000000021";
const PARENT_MULTI = "e8000000-0000-4000-8000-000000000022";
const PARENT_OTHER = "e8000000-0000-4000-8000-000000000023";
const TEACHER_A = "e8000000-0000-4000-8000-000000000030";
const TEACHER_B = "e8000000-0000-4000-8000-000000000031";
const TEACHER_C = "e8000000-0000-4000-8000-000000000032";
const TEACHER_D = "e8000000-0000-4000-8000-000000000033";
const TEACHER_OTHER = "e8000000-0000-4000-8000-000000000034";
const TEACHER_CROSS = "e8000000-0000-4000-8000-000000000035";
const CROSS_PARENT_USER = "e8000000-0000-4000-8000-000000000024";
const CROSS_TEACHER_USER = "e8000000-0000-4000-8000-000000000017";
const CLASS_A = "e8000000-0000-4000-8000-000000000040";
const CLASS_B = "e8000000-0000-4000-8000-000000000041";
const CLASS_OTHER = "e8000000-0000-4000-8000-000000000042";
const YEAR_A = "e8000000-0000-4000-8000-000000000050";
const YEAR_B = "e8000000-0000-4000-8000-000000000051";
const SUBJECT_A = "e8000000-0000-4000-8000-000000000060";
const SUBJECT_B = "e8000000-0000-4000-8000-000000000061";
const SUBJECT_OTHER = "e8000000-0000-4000-8000-000000000062";
const COURSE_A = "e8000000-0000-4000-8000-000000000070";
const COURSE_B = "e8000000-0000-4000-8000-000000000071";
const COURSE_OTHER = "e8000000-0000-4000-8000-000000000072";
const SLOT_A = "e8000000-0000-4000-8000-000000000080";
const SLOT_OTHER = "e8000000-0000-4000-8000-000000000081";
const STUDENT_A1 = "e8000000-0000-4000-8000-000000000090";
const STUDENT_A2 = "e8000000-0000-4000-8000-000000000091";
const STUDENT_B = "e8000000-0000-4000-8000-000000000092";
const NOTE_ID = "f8000000-0000-4000-8000-000000000001";
const OCCURRENCE = "2026-08-24";

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
  const dbName = `somafrik_tr_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

async function seedReplacementFixtures(pool) {
  const countryA = (await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('TR A','CI','+225','XOF') RETURNING id`,
  )).rows[0].id;
  const countryB = (await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('TR B','FR','+33','EUR') RETURNING id`,
  )).rows[0].id;
  await pool.query(
    `INSERT INTO schools (id, country_id, school_code, name, status) VALUES
      ($1,$3,'SCH-TR-A','TR A','active'),($2,$4,'SCH-TR-B','TR B','active')`,
    [SCHOOL_A, SCHOOL_B, countryA, countryB],
  );
  await pool.query(
    `INSERT INTO users (id,school_id,user_code,first_name,last_name,email,role,status) VALUES
      ($1,$8,'ADM-TR-A','Admin','A','adm-tr-a@test.local','Admin School','active'),
      ($2,$9,'ADM-TR-B','Admin','B','adm-tr-b@test.local','Admin School','active'),
      ($3,$8,'ENS-TR-A','Teacher','A','ens-tr-a@test.local','Teacher','active'),
      ($4,$8,'ENS-TR-B','Teacher','B','ens-tr-b@test.local','Teacher','active'),
      ($5,$8,'ENS-TR-C','Teacher','C','ens-tr-c@test.local','Teacher','active'),
      ($6,$8,'ENS-TR-D','Teacher','D','ens-tr-d@test.local','Teacher','active'),
      ($7,$9,'ENS-TR-OTHER','Teacher','Other','ens-other-tr@test.local','Teacher','active'),
      ($10,$8,'PAR-TR-A','Parent','A','par-tr-a@test.local','Parent','active'),
      ($11,$8,'PAR-TR-B','Parent','B','par-tr-b@test.local','Parent','active'),
      ($12,$8,'PAR-TR-MULTI','Parent','Multi','par-multi-tr@test.local','Parent','active'),
      ($13,$8,'PAR-TR-OTHER','Parent','Other','par-other-tr@test.local','Parent','active')`,
    [
      ADMIN_A, ADMIN_B, TEACHER_USER_A, TEACHER_USER_B, TEACHER_USER_C, TEACHER_USER_D,
      TEACHER_USER_OTHER, SCHOOL_A, SCHOOL_B, PARENT_A, PARENT_B, PARENT_MULTI, PARENT_OTHER,
    ],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES
      ($1,$3,'SCHOOL_ADMIN','active'),($2,$4,'SCHOOL_ADMIN','active')`,
    [ADMIN_A, ADMIN_B, SCHOOL_A, SCHOOL_B],
  );
  await pool.query(
    `INSERT INTO academic_years (id,school_id,name,status,start_date,end_date) VALUES
      ($1,$3,'2026-2027','open','2026-08-01','2027-07-31'),
      ($2,$4,'2026-2027','open','2026-08-01','2027-07-31')`,
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
      ($1,$6,$8,'ENS-A','active'),($2,$6,$9,'ENS-B','active'),($3,$6,$10,'ENS-C','active'),
      ($4,$6,$11,'ENS-D','active'),($5,$7,$12,'ENS-OTHER','active')`,
    [TEACHER_A, TEACHER_B, TEACHER_C, TEACHER_D, TEACHER_OTHER, SCHOOL_A, SCHOOL_B,
      TEACHER_USER_A, TEACHER_USER_B, TEACHER_USER_C, TEACHER_USER_D, TEACHER_USER_OTHER],
  );
  await pool.query(
    `INSERT INTO school_courses (id,school_id,class_id,subject_id,teacher_id,course_code,coefficient,status) VALUES
      ($1,$4,$6,$9,$12,'COURSE-A',2,'active'),
      ($2,$4,$7,$10,$13,'COURSE-B',2,'active'),
      ($3,$5,$8,$11,$14,'COURSE-OTHER',2,'active')`,
    [COURSE_A, COURSE_B, COURSE_OTHER, SCHOOL_A, SCHOOL_B, CLASS_A, CLASS_B, CLASS_OTHER,
      SUBJECT_A, SUBJECT_B, SUBJECT_OTHER, TEACHER_A, TEACHER_B, TEACHER_OTHER],
  );
  await pool.query(
    `INSERT INTO course_schedule_weekly_slots
       (id, school_id, academic_year_id, school_course_id, class_id, teacher_id,
        day_of_week, start_time, end_time, status, room)
     VALUES ($1,$2,$3,$4,$5,$6,1,'08:00:00','09:00:00','active','Salle A'),
            ($7,$8,$9,$10,$11,$12,1,'08:00:00','09:00:00','active','Salle B')`,
    [SLOT_A, SCHOOL_A, YEAR_A, COURSE_A, CLASS_A, TEACHER_A,
      SLOT_OTHER, SCHOOL_B, YEAR_B, COURSE_OTHER, CLASS_OTHER, TEACHER_OTHER],
  );
  await pool.query(
    `INSERT INTO students (id,school_id,student_code,first_name,last_name,status) VALUES
      ($1,$4,'STU-A1','Eleve','A1','active'),($2,$4,'STU-A2','Eleve','A2','active'),($3,$5,'STU-B','Eleve','B','active')`,
    [STUDENT_A1, STUDENT_A2, STUDENT_B, SCHOOL_A, SCHOOL_B],
  );
  await pool.query(
    `INSERT INTO enrollments (school_id,student_id,class_id,academic_year_id,enrollment_date,status) VALUES
      ($1,$2,$3,$4,$5,'active'),($1,$6,$3,$4,$5,'active'),($7,$8,$9,$10,$5,'active')`,
    [SCHOOL_A, STUDENT_A1, CLASS_A, YEAR_A, OCCURRENCE, STUDENT_A2, SCHOOL_B, STUDENT_B, CLASS_B, YEAR_B],
  );
  const contactA = (await pool.query(
    `INSERT INTO contacts (school_id,country_id,first_name,last_name,contact_type,phone,status,user_id)
     VALUES ($1,$2,'Parent','A','Parent','+2250101','active',$3) RETURNING id`,
    [SCHOOL_A, countryA, PARENT_A],
  )).rows[0].id;
  const contactMulti = (await pool.query(
    `INSERT INTO contacts (school_id,country_id,first_name,last_name,contact_type,phone,status,user_id)
     VALUES ($1,$2,'Parent','Multi','Parent','+2250102','active',$3) RETURNING id`,
    [SCHOOL_A, countryA, PARENT_MULTI],
  )).rows[0].id;
  const contactOther = (await pool.query(
    `INSERT INTO contacts (school_id,country_id,first_name,last_name,contact_type,phone,status,user_id)
     VALUES ($1,$2,'Parent','Other','Parent','+2250103','active',$3) RETURNING id`,
    [SCHOOL_A, countryA, PARENT_OTHER],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO contact_relations (school_id,country_id,relation_type,contact_id,student_id,status) VALUES
      ($1,$2,'parent_student',$3,$4,'active'),
      ($1,$2,'parent_student',$5,$4,'active'),
      ($1,$2,'parent_student',$5,$6,'active'),
      ($1,$2,'parent_student',$7,$8,'active')`,
    [SCHOOL_A, countryA, contactA, STUDENT_A1, contactMulti, STUDENT_A2, contactOther, STUDENT_B],
  );
}

function adminPrincipal() {
  return { role: "Admin School", schoolCode: "SCH-TR-A", sub: ADMIN_A };
}

const auditMeta = { ipAddress: "127.0.0.1", userAgent: "tr-red-test" };

async function createReplacement(store, substituteTeacherId, extra = {}) {
  return store.createCourseScheduleReplacement(
    {
      weeklySlotId: SLOT_A,
      occurrenceDate: OCCURRENCE,
      substituteTeacherId,
      reason: extra.reason ?? "Absence",
      note: extra.note,
      status: extra.status,
    },
    adminPrincipal(),
    auditMeta,
  );
}

async function outboxForReplacement(pool, replacementId) {
  return (await pool.query(
    `SELECT * FROM communication_event_outbox
     WHERE source_entity_id = $1 AND event_type = $2
     ORDER BY occurred_at, id`,
    [replacementId, TR_EVENT],
  )).rows;
}

async function countOutboxByType(pool, eventType) {
  return (await pool.query(
    `SELECT count(*)::int c FROM communication_event_outbox WHERE event_type = $1`,
    [eventType],
  )).rows[0].c;
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

async function drainReplacement(pool, replacementId) {
  await withRepo(pool, async (repo) => {
    await drainOutbox(repo.getClientsStore(), { limit: 20 });
  });
  return outboxForReplacement(pool, replacementId);
}

async function recipientsForEventKey(pool, eventKey) {
  const note = await pool.query(
    `SELECT id FROM communication_notifications WHERE event_key = $1`,
    [eventKey],
  );
  if (!note.rows.length) return [];
  const rec = await pool.query(
    `SELECT user_id FROM notification_recipients WHERE notification_id = $1 ORDER BY user_id`,
    [note.rows[0].id],
  );
  return rec.rows.map((row) => row.user_id);
}

function outboxEventTypesFromSchema() {
  const schema = read("backend/db/communicationsNotificationsSchema.js");
  const teacherOutbox = read("backend/db/teacherReplacementOutbox.sql");
  const block = schema.slice(schema.indexOf("somafrik_enqueue_communication_event"), schema.indexOf("$$ LANGUAGE plpgsql"));
  const eventTypePattern = /v_event_type(?:\s+TEXT)?\s*:=\s*'([^']+)'/g;
  const matches = [...block.matchAll(eventTypePattern)].map((m) => m[1]);
  const teacherTypes = [...teacherOutbox.matchAll(eventTypePattern)].map((m) => m[1]);
  const sweep = read("backend/lib/communicationsPaymentDueSweep.js");
  const sweepTypes = [...sweep.matchAll(/PD_EVENT = "([^"]+)"/g)].map((m) => m[1]);
  return [...new Set([...matches, ...teacherTypes, ...sweepTypes])].sort();
}

test("RED-TR-02 — mapping dispatcher → TEACHER_REPLACEMENT", () => {
  assert.equal(mapDispatcherEventToLotI(TR_EVENT), "TEACHER_REPLACEMENT");
  assert.match(read("backend/lib/communicationsDispatcher.js"), /"planning\.teacher\.replacement": \["PUSH", "EMAIL"\]/);
  assert.match(read("backend/lib/schoolNotificationPolicy.js"), /"planning\.teacher\.replacement": "TEACHER_REPLACEMENT"/);
});

test("RED-TR-01 — create planned produit un event outbox", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      const rows = await outboxForReplacement(pool, created.id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].event_type, TR_EVENT);
      assert.equal(rows[0].school_id, SCHOOL_A);
    });
  });
});

test("RED-TR-03 — event key durable avec change_revision", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      const row = (await outboxForReplacement(pool, created.id))[0];
      assert.match(row.event_key, /^planning\.teacher\.replacement:[0-9a-f-]+:1$/);
    });
  });
});

test("RED-TR-04 — création planned → revision 1", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      const rev = await pool.query(`SELECT change_revision FROM course_schedule_replacements WHERE id = $1`, [created.id]);
      assert.equal(Number(rev.rows[0].change_revision), 1);
      assert.equal(Number(parseOutboxPayload((await outboxForReplacement(pool, created.id))[0]).changeRevision), 1);
    });
  });
});

test("RED-TR-05 — reason/note seuls → 0 nouvel event", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      assert.equal((await outboxForReplacement(pool, created.id)).length, 1);
      await store.updateCourseScheduleReplacement(created.id, { reason: "Nouvelle raison" }, adminPrincipal(), auditMeta);
      await store.updateCourseScheduleReplacement(created.id, { note: "Note interne" }, adminPrincipal(), auditMeta);
      assert.equal((await outboxForReplacement(pool, created.id)).length, 1);
    });
  });
});

test("RED-TR-06 — planned → completed → 0 nouvel event", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      assert.equal((await outboxForReplacement(pool, created.id)).length, 1);
      await store.updateCourseScheduleReplacement(created.id, { status: "completed" }, adminPrincipal(), auditMeta);
      assert.equal((await outboxForReplacement(pool, created.id)).length, 1);
    });
  });
});

test("RED-TR-07 — réaffectation B→C produit action reassigned", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      await store.updateCourseScheduleReplacement(created.id, { substituteTeacherId: TEACHER_C }, adminPrincipal(), auditMeta);
      const rows = await outboxForReplacement(pool, created.id);
      assert.equal(rows.length, 2);
      assert.equal(parseOutboxPayload(rows[1]).action, "reassigned");
    });
  });
});

test("RED-TR-08 — cycle B→C→B→C préserve toutes les mutations", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      await store.updateCourseScheduleReplacement(created.id, { substituteTeacherId: TEACHER_C }, adminPrincipal(), auditMeta);
      await store.updateCourseScheduleReplacement(created.id, { substituteTeacherId: TEACHER_B }, adminPrincipal(), auditMeta);
      await store.updateCourseScheduleReplacement(created.id, { substituteTeacherId: TEACHER_C }, adminPrincipal(), auditMeta);
      const rows = await outboxForReplacement(pool, created.id);
      assert.equal(rows.length, 4);
      assert.equal(new Set(rows.map((row) => row.event_key)).size, 4);
    });
  });
});

test("RED-TR-09 — cancel produit action cancelled", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      await store.cancelCourseScheduleReplacement(created.id, adminPrincipal(), auditMeta);
      const rows = await outboxForReplacement(pool, created.id);
      assert.equal(rows.length, 2);
      assert.equal(parseOutboxPayload(rows[1]).action, "cancelled");
    });
  });
});

test("RED-TR-10 — cancel ne produit pas TIMETABLE_CHANGED", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    const ttBefore = await countOutboxByType(pool, TT_EVENT);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      await store.cancelCourseScheduleReplacement(created.id, adminPrincipal(), auditMeta);
      assert.ok((await outboxForReplacement(pool, created.id)).length >= 2);
    });
    assert.equal(await countOutboxByType(pool, TT_EVENT), ttBefore);
  });
});

test("RED-TR-11 — weekly-slot teacher update ne produit pas TEACHER_REPLACEMENT", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await pool.query(
      `UPDATE course_schedule_weekly_slots
       SET teacher_id = $2, school_course_id = $3, class_id = $4, updated_at = NOW()
       WHERE id = $1`,
      [SLOT_A, TEACHER_B, COURSE_B, CLASS_B],
    );
    const trCount = await countOutboxByType(pool, TR_EVENT);
    assert.equal(trCount, 0);
    const ttCount = await countOutboxByType(pool, TT_EVENT);
    assert.equal(ttCount, 1);
  });
});

test("RED-TR-12 — assigned notifie titulaire + remplaçant", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      const row = (await outboxForReplacement(pool, created.id))[0];
      await drainReplacement(pool, created.id);
      const recipients = await recipientsForEventKey(pool, row.event_key);
      assert.ok(recipients.includes(TEACHER_USER_A));
      assert.ok(recipients.includes(TEACHER_USER_B));
    });
  });
});

test("RED-TR-13 — reassigned notifie titulaire + ancien + nouveau remplaçant", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      await store.updateCourseScheduleReplacement(created.id, { substituteTeacherId: TEACHER_C }, adminPrincipal(), auditMeta);
      const row = (await outboxForReplacement(pool, created.id))[1];
      await drainReplacement(pool, created.id);
      const recipients = await recipientsForEventKey(pool, row.event_key);
      assert.ok(recipients.includes(TEACHER_USER_A));
      assert.ok(recipients.includes(TEACHER_USER_B));
      assert.ok(recipients.includes(TEACHER_USER_C));
    });
  });
});

test("RED-TR-14 — cancelled notifie titulaire + remplaçant affecté", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      await store.cancelCourseScheduleReplacement(created.id, adminPrincipal(), auditMeta);
      const row = (await outboxForReplacement(pool, created.id))[1];
      await drainReplacement(pool, created.id);
      const recipients = await recipientsForEventKey(pool, row.event_key);
      assert.ok(recipients.includes(TEACHER_USER_A));
      assert.ok(recipients.includes(TEACHER_USER_B));
      assert.equal(recipients.includes(TEACHER_USER_C), false);
    });
  });
});

test("RED-TR-15 — parents de la classe concernée", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      const row = (await outboxForReplacement(pool, created.id))[0];
      await drainReplacement(pool, created.id);
      const recipients = await recipientsForEventKey(pool, row.event_key);
      assert.ok(recipients.includes(PARENT_A));
      assert.ok(recipients.includes(PARENT_MULTI));
    });
  });
});

test("RED-TR-16 — parent autre classe exclu", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      const row = (await outboxForReplacement(pool, created.id))[0];
      await drainReplacement(pool, created.id);
      const recipients = await recipientsForEventKey(pool, row.event_key);
      assert.equal(recipients.includes(PARENT_OTHER), false);
    });
  });
});

test("RED-TR-17 — parent multi-enfants dédupliqué", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      const row = (await outboxForReplacement(pool, created.id))[0];
      await drainReplacement(pool, created.id);
      const count = await pool.query(
        `SELECT count(*)::int c FROM notification_recipients r
         JOIN communication_notifications n ON n.id = r.notification_id
         WHERE n.event_key = $1 AND r.user_id = $2`,
        [row.event_key, PARENT_MULTI],
      );
      assert.equal(count.rows[0].c, 1);
    });
  });
});

test("RED-TR-18 — SCHOOL_ADMIN notifié", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      const row = (await outboxForReplacement(pool, created.id))[0];
      await drainReplacement(pool, created.id);
      const recipients = await recipientsForEventKey(pool, row.event_key);
      assert.ok(recipients.includes(ADMIN_A));
    });
  });
});

test("RED-TR-19 — isolation tenant", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      const row = (await outboxForReplacement(pool, created.id))[0];
      await drainReplacement(pool, created.id);
      const otherAdmin = await pool.query(
        `SELECT count(*)::int c FROM notification_recipients r
         JOIN communication_notifications n ON n.id = r.notification_id
         WHERE r.user_id = $1 AND n.event_type = $2`,
        [ADMIN_B, TR_EVENT],
      );
      assert.equal(otherAdmin.rows[0].c, 0);
      assert.equal(row.school_id, SCHOOL_A);
    });
  });
});

test("RED-TR-20 — politique établissement TEACHER_REPLACEMENT", async () => {
  const policy = requirePolicy();
  const offPush = policy.resolveAllowedChannels({
    event: "TEACHER_REPLACEMENT",
    recipient: "PARENT",
    schoolPolicy: defaultPolicyWith({ TEACHER_REPLACEMENT: { PARENT: { PUSH: false } } }).events,
    userPreferences: { IN_APP: true, PUSH: true, EMAIL: true },
  });
  assert.equal([...offPush].includes("PUSH"), false);
  assert.equal([...offPush].includes("EMAIL"), true);
});

test("RED-TR-21 — préférences utilisateur AND policy", async () => {
  const policy = requirePolicy();
  const onlyEmail = policy.resolveAllowedChannels({
    event: "TEACHER_REPLACEMENT",
    recipient: "TEACHER",
    schoolPolicy: defaultPolicyWith().events,
    userPreferences: { IN_APP: true, PUSH: false, EMAIL: true },
  });
  assert.equal([...onlyEmail].includes("PUSH"), false);
  assert.equal([...onlyEmail].includes("EMAIL"), true);
});

test("RED-TR-22 — aucun legacy double-write", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      await drainReplacement(pool, created.id);
    });
    const legacy = await pool.query(`SELECT count(*)::int c FROM notifications`);
    assert.equal(legacy.rows[0].c, 0);
  });
  assert.doesNotMatch(read("backend/lib/communicationsNotificationsService.js"), /INTO notifications /);
});

test("RED-TR-23 — rollback mutation invalide → 0 outbox parasite", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      await assert.rejects(
        () => createReplacement(store, TEACHER_A),
        (error) => error?.code === "SUBSTITUTE_SAME_AS_ORIGINAL" || /distinct/i.test(String(error?.message ?? "")),
      );
    });
    const count = await pool.query(`SELECT count(*)::int c FROM communication_event_outbox WHERE event_type = $1`, [TR_EVENT]);
    assert.equal(count.rows[0].c, 0);
    const replacements = await pool.query(`SELECT count(*)::int c FROM course_schedule_replacements`);
    assert.equal(replacements.rows[0].c, 0);
  });
});

test("RED-TR-24 — snapshot immuable après réaffectations successives", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      await store.updateCourseScheduleReplacement(created.id, { substituteTeacherId: TEACHER_C }, adminPrincipal(), auditMeta);
      await store.updateCourseScheduleReplacement(created.id, { substituteTeacherId: TEACHER_D }, adminPrincipal(), auditMeta);
      const rows = await outboxForReplacement(pool, created.id);
      assert.equal(rows.length, 3);
      const p1 = parseOutboxPayload(rows[0]);
      const p2 = parseOutboxPayload(rows[1]);
      const p3 = parseOutboxPayload(rows[2]);
      assert.equal(String(p1.substituteTeacherId), TEACHER_B);
      assert.equal(String(p2.substituteTeacherId), TEACHER_C);
      assert.equal(String(p2.previousSubstituteTeacherId), TEACHER_B);
      assert.equal(String(p3.substituteTeacherId), TEACHER_D);
      assert.equal(String(p3.previousSubstituteTeacherId), TEACHER_C);
      await drainReplacement(pool, created.id);
      const r1 = await recipientsForEventKey(pool, rows[0].event_key);
      const r3 = await recipientsForEventKey(pool, rows[2].event_key);
      assert.ok(r1.includes(TEACHER_USER_B));
      assert.equal(r1.includes(TEACHER_USER_D), false);
      assert.ok(r3.includes(TEACHER_USER_D));
    });
  });
});

test("RED-TR-BOOT — bootstrap canonique sans migration L5 manuelle", async () => {
  await withIsolatedPg(async (pool) => {
    const column = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'course_schedule_replacements' AND column_name = 'change_revision' LIMIT 1`,
    );
    assert.equal(column.rowCount, 1);
    const bump = await pool.query(
      `SELECT 1 FROM pg_trigger WHERE tgname = 'trg_course_schedule_replacements_bump_revision' LIMIT 1`,
    );
    assert.equal(bump.rowCount, 1);
    const outboxTrigger = await pool.query(
      `SELECT 1 FROM pg_trigger WHERE tgname = 'trg_c4_teacher_replacement_event' LIMIT 1`,
    );
    assert.equal(outboxTrigger.rowCount, 1);
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      await store.updateCourseScheduleReplacement(created.id, { substituteTeacherId: TEACHER_C }, adminPrincipal(), auditMeta);
      await store.cancelCourseScheduleReplacement(created.id, adminPrincipal(), auditMeta);
      const rows = await outboxForReplacement(pool, created.id);
      assert.equal(rows.length, 3);
      assert.equal(rows[0].event_key, `${TR_EVENT}:${created.id}:1`);
      assert.equal(rows[1].event_key, `${TR_EVENT}:${created.id}:2`);
      assert.equal(rows[2].event_key, `${TR_EVENT}:${created.id}:3`);
    });
  });
});

test("RED-TR-26 — non-régression TIMETABLE_CHANGED : remplacement n'incrémente pas weekly slot revision", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    const before = (await pool.query(`SELECT change_revision FROM course_schedule_weekly_slots WHERE id = $1`, [SLOT_A])).rows[0].change_revision;
    const ttBefore = await countOutboxByType(pool, TT_EVENT);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      await createReplacement(store, TEACHER_B);
    });
    const after = (await pool.query(`SELECT change_revision FROM course_schedule_weekly_slots WHERE id = $1`, [SLOT_A])).rows[0].change_revision;
    assert.equal(String(before), String(after));
    assert.equal(await countOutboxByType(pool, TT_EVENT), ttBefore);
    assert.equal(await countOutboxByType(pool, TR_EVENT), 1);
  });
});

test("RED-TR-27 — AUDIT-COM-FINAL matrice 9/9", () => {
  const wired = outboxEventTypesFromSchema();
  assert.ok(wired.includes(TR_EVENT));
  const mapped = wired.map((eventType) => mapDispatcherEventToLotI(eventType)).filter(Boolean).sort();
  assert.equal(LOT_I_EVENTS.length, 9);
  assert.equal(mapped.length, 9);
  assert.deepEqual(mapped, [
    "ANNOUNCEMENT_PUBLISHED",
    "GRADE_PUBLISHED",
    "PAYMENT_DUE",
    "PAYMENT_RECEIVED",
    "REPORT_CARD_PUBLISHED",
    "STUDENT_ABSENT",
    "STUDENT_LATE",
    "TEACHER_REPLACEMENT",
    "TIMETABLE_CHANGED",
  ]);
  assert.deepEqual(LOT_I_EVENTS.filter((key) => !mapped.includes(key)).sort(), []);
});

test("RED-TR — création remplacement → TEACHER_REPLACEMENT=1 TIMETABLE_CHANGED=0", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      await createReplacement(store, TEACHER_B);
    });
    assert.equal(await countOutboxByType(pool, TR_EVENT), 1);
    assert.equal(await countOutboxByType(pool, TT_EVENT), 0);
  });
});

test("RED-TR — cancel+changement remplaçant atomique → cancelled, pas assigned à C", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      await pool.query(
        `UPDATE course_schedule_replacements
         SET substitute_teacher_id = $2, status = 'cancelled', cancelled_by = $3, updated_at = NOW()
         WHERE id = $1`,
        [created.id, TEACHER_C, ADMIN_A],
      );
      const rows = await outboxForReplacement(pool, created.id);
      assert.equal(rows.length, 2);
      const cancel = parseOutboxPayload(rows[1]);
      assert.equal(cancel.action, "cancelled");
      assert.equal(String(cancel.substituteTeacherId), TEACHER_B);
      await drainReplacement(pool, created.id);
      const recipients = await recipientsForEventKey(pool, rows[1].event_key);
      assert.ok(recipients.includes(TEACHER_USER_B));
      assert.equal(recipients.includes(TEACHER_USER_C), false);
    });
  });
});

test("RED-TR-30 — concurrence réelle : deux transactions simultanées sérialisées par PostgreSQL", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      assert.equal((await outboxForReplacement(pool, created.id)).length, 1);

      const clientA = await pool.connect();
      const clientB = await pool.connect();
      try {
        await clientA.query("BEGIN");
        await clientB.query("BEGIN");
        await clientA.query(
          `UPDATE course_schedule_replacements SET substitute_teacher_id = $2, updated_at = NOW() WHERE id = $1`,
          [created.id, TEACHER_C],
        );
        // TX B démarre pendant que TX A détient encore le verrou ligne : elle
        // reste bloquée jusqu'au COMMIT de A, puis rejoue sur la version validée.
        const blocked = clientB.query(
          `UPDATE course_schedule_replacements SET substitute_teacher_id = $2, updated_at = NOW() WHERE id = $1`,
          [created.id, TEACHER_D],
        );
        const stillBlocked = await Promise.race([
          blocked.then(() => false),
          new Promise((resolve) => setTimeout(() => resolve(true), 750)),
        ]);
        assert.equal(stillBlocked, true, "TX B doit attendre le verrou ligne de TX A");
        await clientA.query("COMMIT");
        await blocked;
        await clientB.query("COMMIT");
      } finally {
        clientA.release();
        clientB.release();
      }

      const rows = await outboxForReplacement(pool, created.id);
      assert.equal(rows.length, 3, "aucun event perdu après sérialisation");
      assert.equal(new Set(rows.map((row) => row.event_key)).size, 3, "aucune clé dupliquée");
      assert.equal(rows[1].event_key, `${TR_EVENT}:${created.id}:2`);
      assert.equal(rows[2].event_key, `${TR_EVENT}:${created.id}:3`);
      assert.equal(String(parseOutboxPayload(rows[1]).substituteTeacherId), TEACHER_C);
      assert.equal(String(parseOutboxPayload(rows[2]).substituteTeacherId), TEACHER_D);
      assert.equal(String(parseOutboxPayload(rows[2]).previousSubstituteTeacherId), TEACHER_C);
      const revision = await pool.query(
        `SELECT change_revision FROM course_schedule_replacements WHERE id = $1`,
        [created.id],
      );
      assert.equal(Number(revision.rows[0].change_revision), 3, "aucune révision perdue");
    });
  });
});

test("RED-TR-28 — parent dont le compte appartient à une autre école n'est jamais recipient", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    const countryB = (await pool.query(`SELECT country_id FROM schools WHERE id = $1`, [SCHOOL_B])).rows[0].country_id;
    // Liaison incohérente tolérée par le schéma : contact école A -> compte école B.
    await pool.query(
      `INSERT INTO users (id,school_id,user_code,first_name,last_name,email,role,status)
       VALUES ($1,$2,'PAR-TR-CROSS','Parent','Cross','par-cross-tr@test.local','Parent','active')`,
      [CROSS_PARENT_USER, SCHOOL_B],
    );
    const crossContact = (await pool.query(
      `INSERT INTO contacts (school_id,country_id,first_name,last_name,contact_type,phone,status,user_id)
       VALUES ($1,$2,'Parent','Cross','Parent','+2250104','active',$3) RETURNING id`,
      [SCHOOL_A, countryB, CROSS_PARENT_USER],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO contact_relations (school_id,country_id,relation_type,contact_id,student_id,status)
       VALUES ($1,$2,'parent_student',$3,$4,'active')`,
      [SCHOOL_A, countryB, crossContact, STUDENT_A1],
    );

    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_B);
      const row = (await outboxForReplacement(pool, created.id))[0];
      await drainReplacement(pool, created.id);
      const recipients = await recipientsForEventKey(pool, row.event_key);
      assert.equal(recipients.includes(CROSS_PARENT_USER), false, "compte parent hors tenant exclu");
      assert.ok(recipients.includes(PARENT_A), "parents canoniques toujours notifiés");
    });

    const crossRows = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients WHERE user_id = $1`,
      [CROSS_PARENT_USER],
    );
    assert.equal(crossRows.rows[0].c, 0);
  });
});

test("RED-TR-29 — enseignant dont le compte appartient à une autre école n'est jamais recipient", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReplacementFixtures(pool);
    // Liaison incohérente tolérée par le schéma : teacher école A -> compte école B.
    await pool.query(
      `INSERT INTO users (id,school_id,user_code,first_name,last_name,email,role,status)
       VALUES ($1,$2,'ENS-TR-CROSS','Teacher','Cross','ens-cross-tr@test.local','Teacher','active')`,
      [CROSS_TEACHER_USER, SCHOOL_B],
    );
    await pool.query(
      `INSERT INTO teachers (id,school_id,user_id,teacher_code,status) VALUES ($1,$2,$3,'ENS-CROSS','active')`,
      [TEACHER_CROSS, SCHOOL_A, CROSS_TEACHER_USER],
    );

    await withRepo(pool, async (repo) => {
      const store = createPedagogyPgStore(repo);
      const created = await createReplacement(store, TEACHER_CROSS);
      const row = (await outboxForReplacement(pool, created.id))[0];
      assert.equal(String(parseOutboxPayload(row).substituteTeacherId), TEACHER_CROSS);
      await drainReplacement(pool, created.id);
      const recipients = await recipientsForEventKey(pool, row.event_key);
      assert.equal(recipients.includes(CROSS_TEACHER_USER), false, "compte enseignant hors tenant exclu");
      assert.ok(recipients.includes(TEACHER_USER_A), "titulaire canonique toujours notifié");
    });

    const crossRows = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients WHERE user_id = $1`,
      [CROSS_TEACHER_USER],
    );
    assert.equal(crossRows.rows[0].c, 0);
  });
});

test("RED-TR-20b — dispatcher policy TEACHER EMAIL OFF établissement", async () => {
  const eventKey = `${TR_EVENT}:policy-test`;
  const adapter = createMemoryDeliveryAdapter({
    notifications: [{
      id: NOTE_ID,
      event_key: eventKey,
      event_type: TR_EVENT,
      school_id: SCHOOL_A,
      title: "Remplacement d'enseignant",
      body: "Un remplacement d'enseignant a été planifié.",
    }],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: TEACHER_USER_A, recipient_kind: "teacher" }],
    users: [{ id: TEACHER_USER_A, school_id: SCHOOL_A, email: "ens-tr-a@test.local" }],
  });
  adapter.schoolNotificationPolicy = defaultPolicyWith({ TEACHER_REPLACEMENT: { TEACHER: { EMAIL: false } } }).events;
  await dispatchCommunication({
    eventKey,
    eventType: TR_EVENT,
    schoolId: SCHOOL_A,
    channels: ["PUSH", "EMAIL"],
    adapter,
    pushStore: { async listActiveForUser() { return [{ expo_push_token: "ExponentPushToken[tr-a]" }]; } },
    pushClient: { async sendToTokens() { return { sent: 1 }; } },
    mailer: { async sendMail() { throw new Error("EMAIL refusé"); } },
    env: envPreprod(),
  });
  assert.equal(adapter.deliveries.some((row) => row.channel === "EMAIL"), false);
  assert.equal(adapter.deliveries.some((row) => row.channel === "PUSH"), true);
});
