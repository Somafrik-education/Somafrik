"use strict";

/**
 * Lot L2 GREEN — REPORT_CARD_PUBLISHED outbox C4.
 * Contrats RED-RC-01 → 13 : producteur pedagogy.report_card.published sur SoT `report_cards.status`.
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
const RC_EVENT = "pedagogy.report_card.published";
const LATE_EVENT = "attendance.student.late";
const SCHOOL_A = "a6000000-0000-4000-8000-000000000001";
const SCHOOL_B = "b6000000-0000-4000-8000-000000000001";
const ADMIN_A = "a6000000-0000-4000-8000-000000000010";
const PARENT_A = "a6000000-0000-4000-8000-000000000011";
const PARENT_B = "b6000000-0000-4000-8000-000000000011";
const PARENT_OTHER = "a6000000-0000-4000-8000-000000000012";
const STUDENT_USER_A = "a6000000-0000-4000-8000-000000000013";
const STUDENT_A = "a6000000-0000-4000-8000-000000000020";
const STUDENT_B = "b6000000-0000-4000-8000-000000000020";
const CLASS_A = "a6000000-0000-4000-8000-000000000030";
const CLASS_B = "b6000000-0000-4000-8000-000000000030";
const YEAR_A = "a6000000-0000-4000-8000-000000000040";
const YEAR_B = "b6000000-0000-4000-8000-000000000041";
const TERM_A1 = "a6000000-0000-4000-8000-000000000050";
const TERM_A2 = "a6000000-0000-4000-8000-000000000051";
const TERM_B1 = "b6000000-0000-4000-8000-000000000050";
const NOTE_ID = "d6000000-0000-4000-8000-000000000001";

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
  const dbName = `somafrik_rc_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
    await pool.query(read("backend/db/migrations/20260914_communication_report_card_published_outbox.sql"));
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

async function seedReportCardFixtures(pool) {
  const countryA = (await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RC A','CI','+225','XOF') RETURNING id`,
  )).rows[0].id;
  const countryB = (await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RC B','FR','+33','EUR') RETURNING id`,
  )).rows[0].id;
  await pool.query(
    `INSERT INTO schools (id, country_id, school_code, name, status) VALUES
      ($1,$3,'SCH-RC-A','RC A','active'),($2,$4,'SCH-RC-B','RC B','active')`,
    [SCHOOL_A, SCHOOL_B, countryA, countryB],
  );
  await pool.query(
    `INSERT INTO users (id,school_id,user_code,first_name,last_name,email,role,status) VALUES
      ($1,$6,'ADM-RC-A','Admin','A','adm-rc-a@test.local','Admin School','active'),
      ($2,$6,'PAR-RC-A','Parent','A','par-rc-a@test.local','Parent','active'),
      ($3,$6,'PAR-RC-OTHER','Parent','Other','par-other-rc@test.local','Parent','active'),
      ($4,$7,'PAR-RC-B','Parent','B','par-rc-b@test.local','Parent','active'),
      ($5,$6,'STU-RC-A','Eleve','A','stu-rc-a@test.local','Student','active')`,
    [ADMIN_A, PARENT_A, PARENT_OTHER, PARENT_B, STUDENT_USER_A, SCHOOL_A, SCHOOL_B],
  );
  await pool.query(
    `INSERT INTO academic_years (id,school_id,name,status) VALUES ($1,$3,'2025-2026','open'),($2,$4,'2025-2026','open')`,
    [YEAR_A, YEAR_B, SCHOOL_A, SCHOOL_B],
  );
  await pool.query(
    `INSERT INTO terms (id,academic_year_id,name,status) VALUES
      ($1,$4,'T1','open'),($2,$4,'T2','open'),($3,$5,'T1','open')`,
    [TERM_A1, TERM_A2, TERM_B1, YEAR_A, YEAR_B],
  );
  await pool.query(
    `INSERT INTO classes (id,school_id,academic_year_id,class_code,name,status) VALUES
      ($1,$3,$5,'CLS-A','6A','active'),($2,$4,$6,'CLS-B','6B','active')`,
    [CLASS_A, CLASS_B, SCHOOL_A, SCHOOL_B, YEAR_A, YEAR_B],
  );
  await pool.query(
    `INSERT INTO students (id,school_id,student_code,first_name,last_name,status) VALUES
      ($1,$3,'STU-RC-A','Eleve','A','active'),($2,$4,'STU-RC-B','Eleve','B','active')`,
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

async function outboxForReportCard(pool, cardId) {
  return (await pool.query(
    `SELECT event_key, event_type, payload FROM communication_event_outbox WHERE source_entity_id = $1 ORDER BY event_key`,
    [cardId],
  )).rows;
}

async function insertReportCard(pool, { id, schoolId, studentId, classId, yearId, termId, status }) {
  await pool.query(
    `INSERT INTO report_cards (id,school_id,student_id,class_id,academic_year_id,term_id,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, schoolId, studentId, classId, yearId, termId, status],
  );
}

async function publishReportCard(pool, cardId) {
  await pool.query(
    `UPDATE report_cards SET status = 'published', published_at = COALESCE(published_at, NOW()), updated_at = NOW() WHERE id = $1`,
    [cardId],
  );
}

test("RED-RC-06 — mapping dispatcher → REPORT_CARD_PUBLISHED", () => {
  assert.equal(mapDispatcherEventToLotI(RC_EVENT), "REPORT_CARD_PUBLISHED");
  assert.match(read("backend/lib/communicationsDispatcher.js"), /"pedagogy\.report_card\.published": \["PUSH", "EMAIL"\]/);
  assert.match(read("backend/lib/schoolNotificationPolicy.js"), /"pedagogy\.report_card\.published": "REPORT_CARD_PUBLISHED"/);
});

test("RED-RC-01 — publication réelle produit un event outbox", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReportCardFixtures(pool);
    const cardId = randomUUID();
    await insertReportCard(pool, {
      id: cardId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      yearId: YEAR_A,
      termId: TERM_A1,
      status: "generated",
    });
    assert.equal((await outboxForReportCard(pool, cardId)).length, 0);
    await publishReportCard(pool, cardId);
    const rows = await outboxForReportCard(pool, cardId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_type, RC_EVENT);
    assert.equal(rows[0].event_key, `${RC_EVENT}:${cardId}`);
  });
});

test("RED-RC-02 — draft / generated ne produit rien", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReportCardFixtures(pool);
    const draftId = randomUUID();
    const generatedId = randomUUID();
    await insertReportCard(pool, {
      id: draftId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      yearId: YEAR_A,
      termId: TERM_A1,
      status: "draft",
    });
    await insertReportCard(pool, {
      id: generatedId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      yearId: YEAR_A,
      termId: TERM_A2,
      status: "generated",
    });
    assert.equal((await outboxForReportCard(pool, draftId)).length, 0);
    assert.equal((await outboxForReportCard(pool, generatedId)).length, 0);
  });
});

test("RED-RC-03 — draft → published produit exactement 1 event", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReportCardFixtures(pool);
    const cardId = randomUUID();
    await insertReportCard(pool, {
      id: cardId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      yearId: YEAR_A,
      termId: TERM_A1,
      status: "draft",
    });
    await publishReportCard(pool, cardId);
    const rows = await outboxForReportCard(pool, cardId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_type, RC_EVENT);
  });
});

test("RED-RC-04 — published → published ne duplique pas", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReportCardFixtures(pool);
    const cardId = randomUUID();
    await insertReportCard(pool, {
      id: cardId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      yearId: YEAR_A,
      termId: TERM_A1,
      status: "generated",
    });
    await publishReportCard(pool, cardId);
    await pool.query(`UPDATE report_cards SET status = 'published' WHERE id = $1`, [cardId]);
    const rows = await outboxForReportCard(pool, cardId);
    assert.equal(rows.length, 1, "published→published sans nouvel event");
  });
});

test("RED-RC-04b — recalcul bulletin publié (class_id) ne réémet pas", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReportCardFixtures(pool);
    const cardId = randomUUID();
    await insertReportCard(pool, {
      id: cardId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      yearId: YEAR_A,
      termId: TERM_A1,
      status: "generated",
    });
    await publishReportCard(pool, cardId);
    await pool.query(`UPDATE report_cards SET class_id = $2, updated_at = NOW() WHERE id = $1`, [cardId, CLASS_A]);
    assert.equal((await outboxForReportCard(pool, cardId)).length, 1);
  });
});

test("RED-RC-05 — event_key déterministe + payload période", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReportCardFixtures(pool);
    const cardT1 = randomUUID();
    const cardT2 = randomUUID();
    await insertReportCard(pool, {
      id: cardT1,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      yearId: YEAR_A,
      termId: TERM_A1,
      status: "generated",
    });
    await insertReportCard(pool, {
      id: cardT2,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      yearId: YEAR_A,
      termId: TERM_A2,
      status: "generated",
    });
    await publishReportCard(pool, cardT1);
    await publishReportCard(pool, cardT2);
    const rowT1 = (await outboxForReportCard(pool, cardT1))[0];
    const rowT2 = (await outboxForReportCard(pool, cardT2))[0];
    assert.equal(rowT1.event_key, `${RC_EVENT}:${cardT1}`);
    assert.equal(rowT2.event_key, `${RC_EVENT}:${cardT2}`);
    assert.equal(rowT1.payload.termId, TERM_A1);
    assert.equal(rowT2.payload.termId, TERM_A2);
    assert.notEqual(rowT1.event_key, rowT2.event_key);
  });
});

test("RED-RC-07 — destinataires parent lié + élève concerné", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReportCardFixtures(pool);
    const cardId = randomUUID();
    await insertReportCard(pool, {
      id: cardId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      yearId: YEAR_A,
      termId: TERM_A1,
      status: "generated",
    });
    await publishReportCard(pool, cardId);
    await withRepo(pool, async (repo) => {
      await drainOutbox(repo.getClientsStore(), { limit: 10 });
    });
    const note = await pool.query(
      `SELECT n.title, n.body, n.navigation_target FROM communication_notifications n WHERE event_key = $1`,
      [`${RC_EVENT}:${cardId}`],
    );
    assert.equal(note.rowCount, 1);
    assert.equal(note.rows[0].title, "Bulletin disponible");
    assert.match(note.rows[0].body, /bulletin scolaire/i);
    assert.equal(note.rows[0].navigation_target.type, "report_card");
    const recipients = await pool.query(
      `SELECT r.user_id, r.recipient_kind FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE n.event_key = $1 ORDER BY r.recipient_kind, r.user_id`,
      [`${RC_EVENT}:${cardId}`],
    );
    assert.equal(recipients.rowCount, 2);
    assert.deepEqual(
      recipients.rows.map((row) => ({ userId: row.user_id, kind: row.recipient_kind })),
      [
        { userId: PARENT_A, kind: "parent" },
        { userId: STUDENT_USER_A, kind: "student" },
      ],
    );
  });
});

test("RED-RC-07b — parent autre élève / autre établissement exclus", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReportCardFixtures(pool);
    const cardId = randomUUID();
    await insertReportCard(pool, {
      id: cardId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      yearId: YEAR_A,
      termId: TERM_A1,
      status: "generated",
    });
    await publishReportCard(pool, cardId);
    await withRepo(pool, async (repo) => {
      await drainOutbox(repo.getClientsStore(), { limit: 10 });
    });
    const otherStudentParent = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE n.event_key = $1 AND r.user_id = $2`,
      [`${RC_EVENT}:${cardId}`, PARENT_OTHER],
    );
    assert.equal(otherStudentParent.rows[0].c, 0);
    const parentB = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE n.event_key = $1 AND r.user_id = $2`,
      [`${RC_EVENT}:${cardId}`, PARENT_B],
    );
    assert.equal(parentB.rows[0].c, 0);
  });
});

test("RED-RC-08 — isolation tenant SCHOOL_A / SCHOOL_B", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReportCardFixtures(pool);
    const cardA = randomUUID();
    const cardB = randomUUID();
    await insertReportCard(pool, {
      id: cardA,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      yearId: YEAR_A,
      termId: TERM_A1,
      status: "generated",
    });
    await insertReportCard(pool, {
      id: cardB,
      schoolId: SCHOOL_B,
      studentId: STUDENT_B,
      classId: CLASS_B,
      yearId: YEAR_B,
      termId: TERM_B1,
      status: "generated",
    });
    await publishReportCard(pool, cardA);
    await publishReportCard(pool, cardB);
    await withRepo(pool, async (repo) => {
      await drainOutbox(repo.getClientsStore(), { limit: 20 });
    });
    const parentAVisible = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE r.user_id = $1 AND n.event_type = $2`,
      [PARENT_A, RC_EVENT],
    );
    const parentBVisible = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE r.user_id = $1 AND n.event_type = $2`,
      [PARENT_B, RC_EVENT],
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

test("RED-RC-09 — politique établissement REPORT_CARD_PUBLISHED appliquée", async () => {
  const policy = requirePolicy();
  const offPush = policy.resolveAllowedChannels({
    event: "REPORT_CARD_PUBLISHED",
    recipient: "PARENT",
    schoolPolicy: defaultPolicyWith({ REPORT_CARD_PUBLISHED: { PARENT: { PUSH: false } } }).events,
    userPreferences: { IN_APP: true, PUSH: true, EMAIL: true },
  });
  assert.equal([...offPush].includes("PUSH"), false);
  assert.equal([...offPush].includes("EMAIL"), true);

  const eventKey = `${RC_EVENT}:policy-test`;
  const adapter = createMemoryDeliveryAdapter({
    notifications: [{
      id: NOTE_ID,
      event_key: eventKey,
      event_type: RC_EVENT,
      school_id: SCHOOL_A,
      title: "Bulletin disponible",
      body: "Un nouveau bulletin scolaire est disponible.",
    }],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: PARENT_A, recipient_kind: "parent" }],
    users: [{ id: PARENT_A, school_id: SCHOOL_A, email: "par-rc-a@test.local" }],
  });
  adapter.schoolNotificationPolicy = defaultPolicyWith({ REPORT_CARD_PUBLISHED: { PARENT: { EMAIL: false } } }).events;
  await dispatchCommunication({
    eventKey,
    eventType: RC_EVENT,
    schoolId: SCHOOL_A,
    channels: ["PUSH", "EMAIL"],
    adapter,
    pushStore: { async listActiveForUser() { return [{ expo_push_token: "ExponentPushToken[rc-a]" }]; } },
    pushClient: { async sendToTokens() { return { sent: 1 }; } },
    mailer: { async sendMail() { throw new Error("EMAIL établissement refusé"); } },
    env: envPreprod(),
  });
  assert.equal(adapter.deliveries.some((row) => row.channel === "EMAIL"), false);
  assert.equal(adapter.deliveries.some((row) => row.channel === "PUSH"), true);
});

test("RED-RC-10 — préférences utilisateur AND policy", async () => {
  const policy = requirePolicy();
  const onlyEmail = policy.resolveAllowedChannels({
    event: "REPORT_CARD_PUBLISHED",
    recipient: "PARENT",
    schoolPolicy: defaultPolicyWith().events,
    userPreferences: { IN_APP: true, PUSH: false, EMAIL: true },
  });
  assert.equal([...onlyEmail].includes("PUSH"), false);
  assert.equal([...onlyEmail].includes("EMAIL"), true);

  const eventKey = `${RC_EVENT}:prefs-test`;
  const adapter = createMemoryDeliveryAdapter({
    notifications: [{
      id: NOTE_ID,
      event_key: eventKey,
      event_type: RC_EVENT,
      school_id: SCHOOL_A,
      title: "Bulletin disponible",
      body: "Un nouveau bulletin scolaire est disponible.",
    }],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: PARENT_A, recipient_kind: "parent" }],
    users: [{ id: PARENT_A, school_id: SCHOOL_A, email: "par-rc-a@test.local" }],
    preferences: [{ user_id: PARENT_A, school_id: SCHOOL_A, channel: "PUSH", enabled: false }],
  });
  adapter.schoolNotificationPolicy = defaultPolicyWith().events;
  await dispatchCommunication({
    eventKey,
    eventType: RC_EVENT,
    schoolId: SCHOOL_A,
    channels: ["PUSH", "EMAIL"],
    adapter,
    pushStore: { async listActiveForUser() { return [{ expo_push_token: "ExponentPushToken[rc-a]" }]; } },
    pushClient: { async sendToTokens() { throw new Error("PUSH refusé"); } },
    mailer: { async sendMail() {} },
    env: envPreprod(),
  });
  assert.equal(adapter.deliveries.some((row) => row.channel === "PUSH"), false);
  assert.equal(adapter.deliveries.some((row) => row.channel === "EMAIL"), true);
});

test("RED-RC-11 — aucun legacy double-write", () => {
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

test("RED-RC-12 — concurrence drainOutbox → une seule notification", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReportCardFixtures(pool);
    const cardId = randomUUID();
    await insertReportCard(pool, {
      id: cardId,
      schoolId: SCHOOL_A,
      studentId: STUDENT_A,
      classId: CLASS_A,
      yearId: YEAR_A,
      termId: TERM_A1,
      status: "generated",
    });
    await publishReportCard(pool, cardId);
    await withRepo(pool, async (repo) => {
      await Promise.all([
        drainOutbox(repo.getClientsStore(), { limit: 10 }),
        drainOutbox(repo.getClientsStore(), { limit: 10 }),
      ]);
    });
    const count = await pool.query(
      `SELECT count(*)::int c FROM communication_notifications WHERE event_key = $1`,
      [`${RC_EVENT}:${cardId}`],
    );
    assert.equal(count.rows[0].c, 1);
    const dup = await pool.query(
      `INSERT INTO communication_event_outbox
         (event_key, event_type, school_id, source_entity_type, source_entity_id, payload)
       VALUES ($1,$2,$3,'report_card',$4,'{}'::jsonb)
       ON CONFLICT (event_key) DO NOTHING RETURNING id`,
      [`${RC_EVENT}:${cardId}`, RC_EVENT, SCHOOL_A, cardId],
    );
    assert.equal(dup.rowCount, 0, "replay SQL ne duplique pas");
  });
});

test("RED-RC-13 — non-régression STUDENT_LATE après migration L2", async () => {
  await withIsolatedPg(async (pool) => {
    await seedReportCardFixtures(pool);
    const attendanceId = randomUUID();
    await pool.query(
      `INSERT INTO attendance (id,school_id,student_id,class_id,attendance_date,status,created_by)
       VALUES ($1,$2,$3,$4,'2026-09-09','late',$5)`,
      [attendanceId, SCHOOL_A, STUDENT_A, CLASS_A, ADMIN_A],
    );
    const rows = await pool.query(
      `SELECT event_key, event_type FROM communication_event_outbox WHERE source_entity_id = $1`,
      [attendanceId],
    );
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0].event_type, LATE_EVENT);
    assert.equal(rows.rows[0].event_key, `${LATE_EVENT}:${attendanceId}`);
  });
});
