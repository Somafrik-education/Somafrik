"use strict";

/**
 * Lot L1 GREEN — STUDENT_LATE outbox C4.
 * Contrats RED-LATE-01 → 10 : producteur attendance.student.late sur SoT `attendance.status`.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const { applyAtomicPayment } = require("../services/paymentTransactionService");
const { createMemoryDeliveryAdapter } = require("./communicationChannelFanout");
const { dispatchCommunication } = require("./communicationsDispatcher");
const { drainOutbox } = require("./communicationsNotificationsService");
const { mapDispatcherEventToLotI } = require("./schoolNotificationPolicy");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");

const ROOT = path.resolve(__dirname, "../..");
const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const LATE_EVENT = "attendance.student.late";
const SCHOOL_A = "a5000000-0000-4000-8000-000000000001";
const SCHOOL_B = "b5000000-0000-4000-8000-000000000001";
const ADMIN_A = "a5000000-0000-4000-8000-000000000010";
const PARENT_A = "a5000000-0000-4000-8000-000000000011";
const PARENT_B = "b5000000-0000-4000-8000-000000000011";
const PARENT_OTHER = "a5000000-0000-4000-8000-000000000012";
const STUDENT_A = "a5000000-0000-4000-8000-000000000020";
const STUDENT_B = "b5000000-0000-4000-8000-000000000020";
const CLASS_A = "a5000000-0000-4000-8000-000000000030";
const CLASS_B = "b5000000-0000-4000-8000-000000000030";
const YEAR_A = "a5000000-0000-4000-8000-000000000040";
const YEAR_B = "b5000000-0000-4000-8000-000000000041";
const NOTE_ID = "c5000000-0000-4000-8000-000000000001";
const CROSS_PARENT_USER = "b5000000-0000-4000-8000-000000000012";

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
  const dbName = `somafrik_late_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const url = withDatabaseName(DATABASE_URL, dbName);
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(read("backend/db/schema.sql"));
    await ensureClientsCanonicalBootstrap(pool, { info() {}, error() {} });
    await pool.query(read("backend/db/migrations/20260913_communication_student_late_outbox.sql"));
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

async function seedLateFixtures(pool) {
  const countryA = (await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('Late A','CI','+225','XOF') RETURNING id`,
  )).rows[0].id;
  const countryB = (await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('Late B','FR','+33','EUR') RETURNING id`,
  )).rows[0].id;
  await pool.query(
    `INSERT INTO schools (id, country_id, school_code, name, status) VALUES
      ($1,$3,'SCH-LATE-A','Late A','active'),($2,$4,'SCH-LATE-B','Late B','active')`,
    [SCHOOL_A, SCHOOL_B, countryA, countryB],
  );
  await pool.query(
    `INSERT INTO users (id,school_id,user_code,first_name,last_name,email,role,status) VALUES
      ($1,$5,'ADM-LATE-A','Admin','A','adm-late-a@test.local','Admin School','active'),
      ($2,$5,'PAR-LATE-A','Parent','A','par-late-a@test.local','Parent','active'),
      ($3,$5,'PAR-LATE-OTHER','Parent','Other','par-other@test.local','Parent','active'),
      ($4,$6,'PAR-LATE-B','Parent','B','par-late-b@test.local','Parent','active')`,
    [ADMIN_A, PARENT_A, PARENT_OTHER, PARENT_B, SCHOOL_A, SCHOOL_B],
  );
  await pool.query(
    `INSERT INTO academic_years (id,school_id,name,status) VALUES ($1,$3,'2025-2026','open'),($2,$4,'2025-2026','open')`,
    [YEAR_A, YEAR_B, SCHOOL_A, SCHOOL_B],
  );
  await pool.query(
    `INSERT INTO classes (id,school_id,academic_year_id,class_code,name,status) VALUES
      ($1,$3,$5,'CLS-A','6A','active'),($2,$4,$6,'CLS-B','6B','active')`,
    [CLASS_A, CLASS_B, SCHOOL_A, SCHOOL_B, YEAR_A, YEAR_B],
  );
  await pool.query(
    `INSERT INTO students (id,school_id,student_code,first_name,last_name,status) VALUES
      ($1,$3,'STU-LATE-A','Eleve','A','active'),($2,$4,'STU-LATE-B','Eleve','B','active')`,
    [STUDENT_A, STUDENT_B, SCHOOL_A, SCHOOL_B],
  );
  await pool.query(
    `INSERT INTO enrollments (school_id,student_id,class_id,academic_year_id,enrollment_date,status)
     VALUES ($1,$2,$3,$4,'2026-09-09','active'),($5,$6,$7,$8,'2026-09-09','active')`,
    [SCHOOL_A, STUDENT_A, CLASS_A, YEAR_A, SCHOOL_B, STUDENT_B, CLASS_B, YEAR_B],
  );
  const contactA = (await pool.query(
    `INSERT INTO contacts (school_id,country_id,first_name,last_name,contact_type,phone,status,user_id)
     VALUES ($1,$2,'Parent','A','Parent','+22501010101','active',$3) RETURNING id`,
    [SCHOOL_A, countryA, PARENT_A],
  )).rows[0].id;
  const contactOther = (await pool.query(
    `INSERT INTO contacts (school_id,country_id,first_name,last_name,contact_type,phone,status,user_id)
     VALUES ($1,$2,'Parent','Other','Parent','+22501010102','active',$3) RETURNING id`,
    [SCHOOL_A, countryA, PARENT_OTHER],
  )).rows[0].id;
  await pool.query(
    `INSERT INTO contact_relations (school_id,country_id,relation_type,contact_id,student_id,status) VALUES
      ($1,$2,'parent_student',$3,$4,'active'),($1,$2,'parent_student',$5,$6,'active')`,
    [SCHOOL_A, countryA, contactA, STUDENT_A, contactOther, STUDENT_B],
  );
}

async function outboxForAttendance(pool, attendanceId) {
  return (await pool.query(
    `SELECT event_key, event_type FROM communication_event_outbox WHERE source_entity_id = $1 ORDER BY event_key`,
    [attendanceId],
  )).rows;
}

async function insertAttendance(pool, { id, schoolId, studentId, classId, status, createdBy }) {
  await pool.query(
    `INSERT INTO attendance (id,school_id,student_id,class_id,attendance_date,status,created_by)
     VALUES ($1,$2,$3,$4,'2026-09-09',$5,$6)`,
    [id, schoolId, studentId, classId, status, createdBy],
  );
}

test("RED-LATE-05 — mapping dispatcher → STUDENT_LATE", () => {
  assert.equal(mapDispatcherEventToLotI(LATE_EVENT), "STUDENT_LATE");
  assert.match(read("backend/lib/communicationsDispatcher.js"), /"attendance\.student\.late": \["PUSH", "EMAIL"\]/);
});

test("RED-LATE-01 — late produit attendance.student.late", async () => {
  await withIsolatedPg(async (pool) => {
    await seedLateFixtures(pool);
    const attendanceId = randomUUID();
    await insertAttendance(pool, {
      id: attendanceId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      status: "late",
      createdBy: ADMIN_A,
    });
    const rows = await outboxForAttendance(pool, attendanceId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_type, LATE_EVENT);
    assert.equal(rows[0].event_key, `${LATE_EVENT}:${attendanceId}`);
  });
});

test("RED-LATE-02 — event_key idempotent (late→late, replay ON CONFLICT)", async () => {
  await withIsolatedPg(async (pool) => {
    await seedLateFixtures(pool);
    const attendanceId = randomUUID();
    await insertAttendance(pool, {
      id: attendanceId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      status: "late",
      createdBy: ADMIN_A,
    });
    await pool.query(`UPDATE attendance SET status = 'late' WHERE id = $1`, [attendanceId]);
    const rows = await outboxForAttendance(pool, attendanceId);
    assert.equal(rows.length, 1, "réécriture late→late sans nouvel event");
    const dup = await pool.query(
      `INSERT INTO communication_event_outbox
         (event_key, event_type, school_id, source_entity_type, source_entity_id, payload)
       VALUES ($1,$2,$3,'attendance',$4,'{}'::jsonb)
       ON CONFLICT (event_key) DO NOTHING RETURNING id`,
      [`${LATE_EVENT}:${attendanceId}`, LATE_EVENT, SCHOOL_A, attendanceId],
    );
    assert.equal(dup.rowCount, 0, "replay SQL ne duplique pas");
  });
});

test("RED-LATE-10 — present → late produit un événement", async () => {
  await withIsolatedPg(async (pool) => {
    await seedLateFixtures(pool);
    const attendanceId = randomUUID();
    await insertAttendance(pool, {
      id: attendanceId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      status: "present",
      createdBy: ADMIN_A,
    });
    assert.equal((await outboxForAttendance(pool, attendanceId)).length, 0);
    await pool.query(`UPDATE attendance SET status = 'late' WHERE id = $1`, [attendanceId]);
    const rows = await outboxForAttendance(pool, attendanceId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_type, LATE_EVENT);
  });
});

test("RED-LATE-09 — PRESENT ne produit aucun événement", async () => {
  await withIsolatedPg(async (pool) => {
    await seedLateFixtures(pool);
    const attendanceId = randomUUID();
    await insertAttendance(pool, {
      id: attendanceId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      status: "present",
      createdBy: ADMIN_A,
    });
    await pool.query(`UPDATE attendance SET status = 'present' WHERE id = $1`, [attendanceId]);
    assert.equal((await outboxForAttendance(pool, attendanceId)).length, 0);
  });
});

test("RED-LATE-10b — absent → late produit attendance.student.late", async () => {
  await withIsolatedPg(async (pool) => {
    await seedLateFixtures(pool);
    const attendanceId = randomUUID();
    await insertAttendance(pool, {
      id: attendanceId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      status: "absent",
      createdBy: ADMIN_A,
    });
    assert.equal((await outboxForAttendance(pool, attendanceId)).length, 1);
    await pool.query(`UPDATE attendance SET status = 'late' WHERE id = $1`, [attendanceId]);
    const rows = await outboxForAttendance(pool, attendanceId);
    assert.equal(rows.length, 2);
    assert.ok(rows.some((row) => row.event_type === LATE_EVENT));
  });
});

test("RED-LATE-03 — recipient parent lié à l'élève", async () => {
  await withIsolatedPg(async (pool) => {
    await seedLateFixtures(pool);
    const attendanceId = randomUUID();
    await insertAttendance(pool, {
      id: attendanceId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      status: "late",
      createdBy: ADMIN_A,
    });
    await withRepo(pool, async (repo) => {
      await drainOutbox(repo.getClientsStore(), { limit: 10 });
    });
    const note = await pool.query(
      `SELECT n.title, n.body FROM communication_notifications n WHERE event_key = $1`,
      [`${LATE_EVENT}:${attendanceId}`],
    );
    assert.equal(note.rowCount, 1);
    assert.equal(note.rows[0].title, "Retard enregistré");
    assert.match(note.rows[0].body, /retard/i);
    const recipients = await pool.query(
      `SELECT r.user_id FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE n.event_key = $1 ORDER BY r.user_id`,
      [`${LATE_EVENT}:${attendanceId}`],
    );
    assert.deepEqual(recipients.rows.map((row) => row.user_id), [PARENT_A]);
  });
});

test("RED-LATE-04 — isolation tenant SCHOOL_A / SCHOOL_B", async () => {
  await withIsolatedPg(async (pool) => {
    await seedLateFixtures(pool);
    const lateA = randomUUID();
    const lateB = randomUUID();
    await insertAttendance(pool, {
      id: lateA,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      status: "late",
      createdBy: ADMIN_A,
    });
    await insertAttendance(pool, {
      id: lateB,
      schoolId: SCHOOL_B,
      studentId: STUDENT_B,
      classId: CLASS_B,
      status: "late",
      createdBy: ADMIN_A,
    });
    await withRepo(pool, async (repo) => {
      await drainOutbox(repo.getClientsStore(), { limit: 20 });
    });
    const parentAVisible = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE r.user_id = $1 AND n.event_type = $2`,
      [PARENT_A, LATE_EVENT],
    );
    const parentBVisible = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE r.user_id = $1 AND n.event_type = $2`,
      [PARENT_B, LATE_EVENT],
    );
    assert.equal(parentAVisible.rows[0].c, 1);
    assert.equal(parentBVisible.rows[0].c, 0);
    const crossSchool = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE r.user_id = $1 AND n.school_id = $2`,
      [PARENT_A, SCHOOL_B],
    );
    assert.equal(crossSchool.rows[0].c, 0);
  });
});

test("RED-LATE-02b — concurrence drainOutbox → une seule notification", async () => {
  await withIsolatedPg(async (pool) => {
    await seedLateFixtures(pool);
    const attendanceId = randomUUID();
    await insertAttendance(pool, {
      id: attendanceId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      status: "late",
      createdBy: ADMIN_A,
    });
    await withRepo(pool, async (repo) => {
      await Promise.all([drainOutbox(repo.getClientsStore(), { limit: 10 }), drainOutbox(repo.getClientsStore(), { limit: 10 })]);
    });
    const count = await pool.query(
      `SELECT count(*)::int c FROM communication_notifications WHERE event_key = $1`,
      [`${LATE_EVENT}:${attendanceId}`],
    );
    assert.equal(count.rows[0].c, 1);
  });
});

test("RED-LATE-06 — politique établissement STUDENT_LATE appliquée", async () => {
  const policy = requirePolicy();
  const offPush = policy.resolveAllowedChannels({
    event: "STUDENT_LATE",
    recipient: "PARENT",
    schoolPolicy: defaultPolicyWith({ STUDENT_LATE: { PARENT: { PUSH: false } } }).events,
    userPreferences: { IN_APP: true, PUSH: true, EMAIL: true },
  });
  assert.equal([...offPush].includes("PUSH"), false);
  assert.equal([...offPush].includes("EMAIL"), true);

  const eventKey = `${LATE_EVENT}:policy-test`;
  const adapter = createMemoryDeliveryAdapter({
    notifications: [{
      id: NOTE_ID,
      event_key: eventKey,
      event_type: LATE_EVENT,
      school_id: SCHOOL_A,
      title: "Retard enregistré",
      body: "Un retard a été enregistré pour votre enfant.",
    }],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: PARENT_A, recipient_kind: "parent" }],
    users: [{ id: PARENT_A, school_id: SCHOOL_A, email: "par-late-a@test.local" }],
  });
  adapter.schoolNotificationPolicy = defaultPolicyWith({ STUDENT_LATE: { PARENT: { EMAIL: false } } }).events;
  await dispatchCommunication({
    eventKey,
    eventType: LATE_EVENT,
    schoolId: SCHOOL_A,
    channels: ["PUSH", "EMAIL"],
    adapter,
    pushStore: { async listActiveForUser() { return [{ expo_push_token: "ExponentPushToken[late-a]" }]; } },
    pushClient: { async sendToTokens() { return { sent: 1 }; } },
    mailer: { async sendMail() { throw new Error("EMAIL établissement refusé"); } },
    env: envPreprod(),
  });
  assert.equal(adapter.deliveries.some((row) => row.channel === "EMAIL"), false);
  assert.equal(adapter.deliveries.some((row) => row.channel === "PUSH"), true);
});

test("RED-LATE-07 — préférences utilisateur AND policy", async () => {
  const policy = requirePolicy();
  const onlyEmail = policy.resolveAllowedChannels({
    event: "STUDENT_LATE",
    recipient: "PARENT",
    schoolPolicy: defaultPolicyWith().events,
    userPreferences: { IN_APP: true, PUSH: false, EMAIL: true },
  });
  assert.equal([...onlyEmail].includes("PUSH"), false);
  assert.equal([...onlyEmail].includes("EMAIL"), true);

  const eventKey = `${LATE_EVENT}:prefs-test`;
  const adapter = createMemoryDeliveryAdapter({
    notifications: [{
      id: NOTE_ID,
      event_key: eventKey,
      event_type: LATE_EVENT,
      school_id: SCHOOL_A,
      title: "Retard enregistré",
      body: "Un retard a été enregistré pour votre enfant.",
    }],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: PARENT_A, recipient_kind: "parent" }],
    users: [{ id: PARENT_A, school_id: SCHOOL_A, email: "par-late-a@test.local" }],
    preferences: [{ user_id: PARENT_A, school_id: SCHOOL_A, channel: "PUSH", enabled: false }],
  });
  adapter.schoolNotificationPolicy = defaultPolicyWith().events;
  await dispatchCommunication({
    eventKey,
    eventType: LATE_EVENT,
    schoolId: SCHOOL_A,
    channels: ["PUSH", "EMAIL"],
    adapter,
    pushStore: { async listActiveForUser() { return [{ expo_push_token: "ExponentPushToken[late-a]" }]; } },
    pushClient: { async sendToTokens() { throw new Error("PUSH refusé"); } },
    mailer: { async sendMail() {} },
    env: envPreprod(),
  });
  assert.equal(adapter.deliveries.some((row) => row.channel === "PUSH"), false);
  assert.equal(adapter.deliveries.some((row) => row.channel === "EMAIL"), true);
});

test("RED-LATE-08 — pas de legacy double-write", () => {
  const service = read("backend/lib/communicationsNotificationsService.js");
  assert.doesNotMatch(service, /INTO notifications /);
  const existing = [{ id: "LEGACY", status: "Non lu" }];
  const { nextState } = applyAtomicPayment(
    stateWithNotifications(existing),
    {
      studentId: "stu-1",
      feeType: "Scolarité",
      amount: 1000,
      method: "Espèces",
      date: "2026-09-09",
    },
    { firstName: "Admin", lastName: "School", sub: "u1", identifier: "admin" },
  );
  assert.equal(nextState.notifications, existing);
});

function stateWithNotifications(notifications) {
  return {
    students: [{ id: "stu-1", firstName: "A", lastName: "B", schoolCode: "SCH-1" }],
    schools: [{ code: "SCH-1", currency: "CDF" }],
    payments: [],
    studentFees: [],
    notifications,
    auditLog: [],
  };
}

test("RED-LATE-03b — parent autre élève / autre établissement exclus", async () => {
  await withIsolatedPg(async (pool) => {
    await seedLateFixtures(pool);
    const attendanceId = randomUUID();
    await insertAttendance(pool, {
      id: attendanceId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      status: "late",
      createdBy: ADMIN_A,
    });
    await withRepo(pool, async (repo) => {
      await drainOutbox(repo.getClientsStore(), { limit: 10 });
    });
    const otherStudentParent = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE n.event_key = $1 AND r.user_id = $2`,
      [`${LATE_EVENT}:${attendanceId}`, PARENT_OTHER],
    );
    assert.equal(otherStudentParent.rows[0].c, 0);
  });
});

test("RED-LATE-03c — parent historique dont le compte appartient à une autre école n'est jamais recipient", async () => {
  await withIsolatedPg(async (pool) => {
    await seedLateFixtures(pool);
    const countryA = (await pool.query(`SELECT country_id FROM schools WHERE id = $1`, [SCHOOL_A])).rows[0].country_id;
    // Liaison incohérente tolérée par le schéma : contact école A -> compte école B.
    await pool.query(
      `INSERT INTO users (id,school_id,user_code,first_name,last_name,email,role,status)
       VALUES ($1,$2,'PAR-LATE-CROSS','Parent','Cross','par-cross-late@test.local','Parent','active')`,
      [CROSS_PARENT_USER, SCHOOL_B],
    );
    const crossContact = (await pool.query(
      `INSERT INTO contacts (school_id,country_id,first_name,last_name,contact_type,phone,status,user_id)
       VALUES ($1,$2,'Parent','Cross','Parent','+22501010103','active',$3) RETURNING id`,
      [SCHOOL_A, countryA, CROSS_PARENT_USER],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO contact_relations (school_id,country_id,relation_type,contact_id,student_id,status)
       VALUES ($1,$2,'parent_student',$3,$4,'active')`,
      [SCHOOL_A, countryA, crossContact, STUDENT_A],
    );

    const attendanceId = randomUUID();
    await insertAttendance(pool, {
      id: attendanceId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      status: "late",
      createdBy: ADMIN_A,
    });
    await withRepo(pool, async (repo) => {
      await drainOutbox(repo.getClientsStore(), { limit: 10 });
    });
    const recipients = (await pool.query(
      `SELECT r.user_id FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE n.event_key = $1`,
      [`${LATE_EVENT}:${attendanceId}`],
    )).rows.map((row) => row.user_id);
    assert.equal(recipients.includes(CROSS_PARENT_USER), false, "compte parent hors tenant exclu");
    assert.ok(recipients.includes(PARENT_A), "parent canonique toujours notifié");

    const crossRows = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients WHERE user_id = $1`,
      [CROSS_PARENT_USER],
    );
    assert.equal(crossRows.rows[0].c, 0);
  });
});
