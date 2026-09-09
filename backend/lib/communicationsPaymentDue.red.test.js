"use strict";

/**
 * Lot L3 GREEN — PAYMENT_DUE outbox C4.
 * Contrats RED-PD-01 → 16 : producteur finance.payment.due via balayage idempotent
 * sur SoT `student_fee_obligations` (due_date DATE, balance, statut Finance).
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
const { sweepPaymentDueOutbox, PD_EVENT, eventKeyForObligation } = require("./communicationsPaymentDueSweep");
const { isPaymentDueEligible } = require("./communicationsPaymentDueEligibility");
const { mapDispatcherEventToLotI, LOT_I_EVENTS } = require("./schoolNotificationPolicy");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");
const { FINANCE_SCHEMA_SQL } = require("../db/financeSchema");

const ROOT = path.resolve(__dirname, "../..");
const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const REF_DATE = "2026-09-10";
const SCHOOL_A = "a7000000-0000-4000-8000-000000000001";
const SCHOOL_B = "b7000000-0000-4000-8000-000000000001";
const ADMIN_A = "a7000000-0000-4000-8000-000000000010";
const PARENT_A = "a7000000-0000-4000-8000-000000000011";
const PARENT_B = "b7000000-0000-4000-8000-000000000011";
const PARENT_OTHER = "a7000000-0000-4000-8000-000000000012";
const STUDENT_A = "a7000000-0000-4000-8000-000000000020";
const STUDENT_B = "b7000000-0000-4000-8000-000000000020";
const CLASS_A = "a7000000-0000-4000-8000-000000000030";
const CLASS_B = "b7000000-0000-4000-8000-000000000030";
const YEAR_A = "a7000000-0000-4000-8000-000000000040";
const YEAR_B = "b7000000-0000-4000-8000-000000000041";
const NOTE_ID = "d7000000-0000-4000-8000-000000000001";

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
  const dbName = `somafrik_pd_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const url = withDatabaseName(DATABASE_URL, dbName);
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(read("backend/db/schema.sql"));
    await pool.query(FINANCE_SCHEMA_SQL);
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

async function seedPaymentDueFixtures(pool) {
  const countryA = (await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('PD A','CI','+225','XOF') RETURNING id`,
  )).rows[0].id;
  const countryB = (await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('PD B','FR','+33','EUR') RETURNING id`,
  )).rows[0].id;
  await pool.query(
    `INSERT INTO schools (id, country_id, school_code, name, status) VALUES
      ($1,$3,'SCH-PD-A','PD A','active'),($2,$4,'SCH-PD-B','PD B','active')`,
    [SCHOOL_A, SCHOOL_B, countryA, countryB],
  );
  await pool.query(
    `INSERT INTO users (id,school_id,user_code,first_name,last_name,email,role,status) VALUES
      ($1,$5,'ADM-PD-A','Admin','A','adm-pd-a@test.local','Admin School','active'),
      ($2,$5,'PAR-PD-A','Parent','A','par-pd-a@test.local','Parent','active'),
      ($3,$5,'PAR-PD-OTHER','Parent','Other','par-other-pd@test.local','Parent','active'),
      ($4,$6,'PAR-PD-B','Parent','B','par-pd-b@test.local','Parent','active')`,
    [ADMIN_A, PARENT_A, PARENT_OTHER, PARENT_B, SCHOOL_A, SCHOOL_B],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1,$2,'SCHOOL_ADMIN','active')`,
    [ADMIN_A, SCHOOL_A],
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
      ($1,$3,'STU-PD-A','Eleve','A','active'),($2,$4,'STU-PD-B','Eleve','B','active')`,
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

async function insertObligation(pool, {
  id = randomUUID(),
  schoolId = SCHOOL_A,
  studentId = STUDENT_A,
  classId = CLASS_A,
  amountDue = 50000,
  dueDate,
  exemption = 0,
  status,
  archivedAt = null,
  cancelledAt = null,
}) {
  await pool.query(
    `INSERT INTO student_fee_obligations (
       id, school_id, student_id, class_id, fee_type, label, currency,
       amount_due, exemption, due_date, archived_at, cancelled_at, status
     ) VALUES ($1,$2,$3,$4,'Scolarité','Scolarité','XOF',$5,$6,$7,$8,$9,COALESCE($10,'À payer'))`,
    [id, schoolId, studentId, classId, amountDue, exemption, dueDate, archivedAt, cancelledAt, status],
  );
  return id;
}

async function outboxForObligation(pool, obligationId) {
  return (await pool.query(
    `SELECT event_key, event_type, payload FROM communication_event_outbox WHERE source_entity_id = $1 ORDER BY event_key`,
    [obligationId],
  )).rows;
}

async function allocatePayment(pool, { obligationId, schoolId = SCHOOL_A, studentId = STUDENT_A, amount, createdBy = ADMIN_A }) {
  const paymentId = randomUUID();
  await pool.query(
    `INSERT INTO payments (id,school_id,student_id,payment_code,amount,currency,payment_method,payment_status,payment_date,created_by)
     VALUES ($1,$2,$3,$4,$5,'XOF','cash','paid','2026-09-09',$6)`,
    [paymentId, schoolId, studentId, `PAY-${paymentId.slice(0, 8)}`, amount, createdBy],
  );
  await pool.query(
    `INSERT INTO payment_allocations (school_id, payment_id, obligation_id, amount) VALUES ($1,$2,$3,$4)`,
    [schoolId, paymentId, obligationId, amount],
  );
  return paymentId;
}

test("RED-PD-03 — mapping dispatcher → PAYMENT_DUE", () => {
  assert.equal(mapDispatcherEventToLotI(PD_EVENT), "PAYMENT_DUE");
  assert.match(read("backend/lib/communicationsDispatcher.js"), /"finance\.payment\.due": \["PUSH", "EMAIL"\]/);
  assert.match(read("backend/lib/communicationsPaymentDueSweep.js"), /paymentDueEligibleSqlConditions/);
  assert.match(read("backend/lib/communicationsNotificationsService.js"), /isPaymentDueEligible/);
  assert.match(read("backend/lib/communicationsNotificationsService.js"), /FOR UPDATE OF o/);
});

test("RED-PD-01 — obligation future → aucun event immédiat", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPaymentDueFixtures(pool);
    const obligationId = await insertObligation(pool, { dueDate: "2026-12-01" });
    await withRepo(pool, async (repo) => {
      await sweepPaymentDueOutbox(repo.getClientsStore(), { referenceDate: REF_DATE });
    });
    assert.equal((await outboxForObligation(pool, obligationId)).length, 0);
  });
});

test("RED-PD-02 — obligation devient due → 1 event", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPaymentDueFixtures(pool);
    const obligationId = await insertObligation(pool, { dueDate: "2026-09-05" });
    await withRepo(pool, async (repo) => {
      const inserted = await sweepPaymentDueOutbox(repo.getClientsStore(), { referenceDate: REF_DATE });
      assert.equal(inserted.length, 1);
    });
    const rows = await outboxForObligation(pool, obligationId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_type, PD_EVENT);
    assert.equal(rows[0].event_key, eventKeyForObligation(obligationId));
  });
});

test("RED-PD-04 — event key déterministe", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPaymentDueFixtures(pool);
    const obligationId = await insertObligation(pool, { dueDate: "2026-09-01" });
    await withRepo(pool, async (repo) => {
      await sweepPaymentDueOutbox(repo.getClientsStore(), { referenceDate: REF_DATE });
    });
    const row = (await outboxForObligation(pool, obligationId))[0];
    assert.equal(row.event_key, `finance.payment.due:${obligationId}`);
    assert.equal(row.payload.obligationId, obligationId);
    assert.equal(row.payload.dueDate, "2026-09-01");
  });
});

test("RED-PD-05 — rerun scheduler → pas de doublon", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPaymentDueFixtures(pool);
    const obligationId = await insertObligation(pool, { dueDate: "2026-09-03" });
    await withRepo(pool, async (repo) => {
      const store = repo.getClientsStore();
      await sweepPaymentDueOutbox(store, { referenceDate: REF_DATE });
      await sweepPaymentDueOutbox(store, { referenceDate: REF_DATE });
    });
    assert.equal((await outboxForObligation(pool, obligationId)).length, 1);
  });
});

test("RED-PD-06 — deux workers concurrents → 1 event", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPaymentDueFixtures(pool);
    const obligationId = await insertObligation(pool, { dueDate: "2026-09-02" });
    await withRepo(pool, async (repo) => {
      const store = repo.getClientsStore();
      await Promise.all([
        sweepPaymentDueOutbox(store, { referenceDate: REF_DATE }),
        sweepPaymentDueOutbox(store, { referenceDate: REF_DATE }),
      ]);
    });
    assert.equal((await outboxForObligation(pool, obligationId)).length, 1);
  });
});

test("RED-PD-07 — obligation déjà payée → aucun PAYMENT_DUE", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPaymentDueFixtures(pool);
    const obligationId = await insertObligation(pool, { dueDate: "2026-09-04", amountDue: 10000 });
    await allocatePayment(pool, { obligationId, amount: 10000 });
    await withRepo(pool, async (repo) => {
      await sweepPaymentDueOutbox(repo.getClientsStore(), { referenceDate: REF_DATE });
    });
    assert.equal((await outboxForObligation(pool, obligationId)).length, 0);
  });
});

test("RED-PD-08 — paiement partiel → PAYMENT_DUE si solde > 0", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPaymentDueFixtures(pool);
    const obligationId = await insertObligation(pool, { dueDate: "2026-09-04", amountDue: 10000 });
    await allocatePayment(pool, { obligationId, amount: 4000 });
    await withRepo(pool, async (repo) => {
      await sweepPaymentDueOutbox(repo.getClientsStore(), { referenceDate: REF_DATE });
    });
    assert.equal((await outboxForObligation(pool, obligationId)).length, 1);
    const row = (await pool.query(`SELECT balance, status FROM student_fee_obligations WHERE id = $1`, [obligationId])).rows[0];
    assert.ok(Number(row.balance) > 0);
    assert.equal(row.status, "Partiellement payé");
  });
});

test("RED-PD-09 — obligation annulée/exonérée → aucun event", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPaymentDueFixtures(pool);
    const cancelledId = await insertObligation(pool, { dueDate: "2026-09-01", archivedAt: new Date().toISOString() });
    const exemptId = await insertObligation(pool, { dueDate: "2026-09-01", amountDue: 5000, exemption: 5000 });
    await withRepo(pool, async (repo) => {
      await sweepPaymentDueOutbox(repo.getClientsStore(), { referenceDate: REF_DATE });
    });
    assert.equal((await outboxForObligation(pool, cancelledId)).length, 0);
    assert.equal((await outboxForObligation(pool, exemptId)).length, 0);
  });
});

test("RED-PD-10 — recipients parent + school admin", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPaymentDueFixtures(pool);
    const obligationId = await insertObligation(pool, { dueDate: "2026-09-05" });
    await withRepo(pool, async (repo) => {
      await sweepPaymentDueOutbox(repo.getClientsStore(), { referenceDate: REF_DATE });
      await drainOutbox(repo.getClientsStore(), { limit: 10 });
    });
    const note = await pool.query(
      `SELECT n.title, n.body FROM communication_notifications n WHERE event_key = $1`,
      [eventKeyForObligation(obligationId)],
    );
    assert.equal(note.rowCount, 1);
    assert.equal(note.rows[0].title, "Paiement arrivé à échéance");
    assert.equal(note.rows[0].body, "Un paiement scolaire est arrivé à échéance.");
    const recipients = await pool.query(
      `SELECT r.user_id, r.recipient_kind FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE n.event_key = $1 ORDER BY r.recipient_kind, r.user_id`,
      [eventKeyForObligation(obligationId)],
    );
    assert.ok(recipients.rowCount >= 2);
    assert.ok(recipients.rows.some((row) => row.user_id === PARENT_A && row.recipient_kind === "parent"));
    assert.ok(recipients.rows.some((row) => row.user_id === ADMIN_A && row.recipient_kind === "school_admin"));
  });
});

test("RED-PD-10b — parent autre élève / autre établissement exclus", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPaymentDueFixtures(pool);
    const obligationId = await insertObligation(pool, { dueDate: "2026-09-05" });
    await withRepo(pool, async (repo) => {
      await sweepPaymentDueOutbox(repo.getClientsStore(), { referenceDate: REF_DATE });
      await drainOutbox(repo.getClientsStore(), { limit: 10 });
    });
    const otherParent = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE n.event_key = $1 AND r.user_id = $2`,
      [eventKeyForObligation(obligationId), PARENT_OTHER],
    );
    assert.equal(otherParent.rows[0].c, 0);
  });
});

test("RED-PD-11 — isolation tenant SCHOOL_A / SCHOOL_B", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPaymentDueFixtures(pool);
    const obligationA = await insertObligation(pool, { dueDate: "2026-09-05" });
    const obligationB = await insertObligation(pool, {
      schoolId: SCHOOL_B,
      studentId: STUDENT_B,
      classId: CLASS_B,
      dueDate: "2026-09-05",
    });
    await withRepo(pool, async (repo) => {
      await sweepPaymentDueOutbox(repo.getClientsStore(), { referenceDate: REF_DATE });
      await drainOutbox(repo.getClientsStore(), { limit: 20 });
    });
    const parentAVisible = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE r.user_id = $1 AND n.event_type = $2`,
      [PARENT_A, PD_EVENT],
    );
    const parentBVisible = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE r.user_id = $1 AND n.event_type = $2`,
      [PARENT_B, PD_EVENT],
    );
    assert.equal(parentAVisible.rows[0].c, 1);
    assert.equal(parentBVisible.rows[0].c, 0);
    assert.equal((await outboxForObligation(pool, obligationA)).length, 1);
    assert.equal((await outboxForObligation(pool, obligationB)).length, 1);
  });
});

test("RED-PD-12 — politique établissement PAYMENT_DUE appliquée", async () => {
  const policy = requirePolicy();
  const offPush = policy.resolveAllowedChannels({
    event: "PAYMENT_DUE",
    recipient: "PARENT",
    schoolPolicy: defaultPolicyWith({ PAYMENT_DUE: { PARENT: { PUSH: false } } }).events,
    userPreferences: { IN_APP: true, PUSH: true, EMAIL: true },
  });
  assert.equal([...offPush].includes("PUSH"), false);
  assert.equal([...offPush].includes("EMAIL"), true);

  const eventKey = `${PD_EVENT}:policy-test`;
  const adapter = createMemoryDeliveryAdapter({
    notifications: [{
      id: NOTE_ID,
      event_key: eventKey,
      event_type: PD_EVENT,
      school_id: SCHOOL_A,
      title: "Paiement arrivé à échéance",
      body: "Un paiement scolaire est arrivé à échéance.",
    }],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: PARENT_A, recipient_kind: "parent" }],
    users: [{ id: PARENT_A, school_id: SCHOOL_A, email: "par-pd-a@test.local" }],
  });
  adapter.schoolNotificationPolicy = defaultPolicyWith({ PAYMENT_DUE: { PARENT: { EMAIL: false } } }).events;
  await dispatchCommunication({
    eventKey,
    eventType: PD_EVENT,
    schoolId: SCHOOL_A,
    channels: ["PUSH", "EMAIL"],
    adapter,
    pushStore: { async listActiveForUser() { return [{ expo_push_token: "ExponentPushToken[pd-a]" }]; } },
    pushClient: { async sendToTokens() { return { sent: 1 }; } },
    mailer: { async sendMail() { throw new Error("EMAIL établissement refusé"); } },
    env: envPreprod(),
  });
  assert.equal(adapter.deliveries.some((row) => row.channel === "EMAIL"), false);
  assert.equal(adapter.deliveries.some((row) => row.channel === "PUSH"), true);
});

test("RED-PD-13 — préférences utilisateur AND policy", async () => {
  const policy = requirePolicy();
  const onlyEmail = policy.resolveAllowedChannels({
    event: "PAYMENT_DUE",
    recipient: "PARENT",
    schoolPolicy: defaultPolicyWith().events,
    userPreferences: { IN_APP: true, PUSH: false, EMAIL: true },
  });
  assert.equal([...onlyEmail].includes("PUSH"), false);
  assert.equal([...onlyEmail].includes("EMAIL"), true);

  const eventKey = `${PD_EVENT}:prefs-test`;
  const adapter = createMemoryDeliveryAdapter({
    notifications: [{
      id: NOTE_ID,
      event_key: eventKey,
      event_type: PD_EVENT,
      school_id: SCHOOL_A,
      title: "Paiement arrivé à échéance",
      body: "Un paiement scolaire est arrivé à échéance.",
    }],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: PARENT_A, recipient_kind: "parent" }],
    users: [{ id: PARENT_A, school_id: SCHOOL_A, email: "par-pd-a@test.local" }],
    preferences: [{ user_id: PARENT_A, school_id: SCHOOL_A, channel: "PUSH", enabled: false }],
  });
  adapter.schoolNotificationPolicy = defaultPolicyWith().events;
  await dispatchCommunication({
    eventKey,
    eventType: PD_EVENT,
    schoolId: SCHOOL_A,
    channels: ["PUSH", "EMAIL"],
    adapter,
    pushStore: { async listActiveForUser() { return [{ expo_push_token: "ExponentPushToken[pd-a]" }]; } },
    pushClient: { async sendToTokens() { throw new Error("PUSH refusé"); } },
    mailer: { async sendMail() {} },
    env: envPreprod(),
  });
  assert.equal(adapter.deliveries.some((row) => row.channel === "PUSH"), false);
  assert.equal(adapter.deliveries.some((row) => row.channel === "EMAIL"), true);
});

test("RED-PD-14 — aucun legacy double-write", () => {
  const service = read("backend/lib/communicationsNotificationsService.js");
  const sweep = read("backend/lib/communicationsPaymentDueSweep.js");
  assert.doesNotMatch(service, /INTO notifications /);
  assert.doesNotMatch(sweep, /INTO notifications /);
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

test("RED-PD-15 — non-régression PAYMENT_RECEIVED", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPaymentDueFixtures(pool);
    const paymentId = randomUUID();
    await pool.query(
      `INSERT INTO payments (id,school_id,student_id,payment_code,amount,currency,payment_method,payment_status,payment_date,created_by)
       VALUES ($1,$2,$3,'PAY-RCV',25000,'XOF','cash','paid','2026-09-09',$4)`,
      [paymentId, SCHOOL_A, STUDENT_A, ADMIN_A],
    );
    const rows = await pool.query(
      `SELECT event_type, event_key FROM communication_event_outbox WHERE source_entity_id = $1`,
      [paymentId],
    );
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0].event_type, "finance.payment.recorded");
    assert.equal(rows.rows[0].event_key, `finance.payment.recorded:${paymentId}`);
  });
});

test("RED-PD-16 — matrice Lot I 7/9 inclut PAYMENT_DUE", () => {
  const schema = read("backend/db/communicationsNotificationsSchema.js");
  const sweep = read("backend/lib/communicationsPaymentDueSweep.js");
  const triggerTypes = [...schema.slice(schema.indexOf("somafrik_enqueue_communication_event"), schema.indexOf("$$ LANGUAGE plpgsql"))
    .matchAll(/v_event_type := '([^']+)'/g)].map((m) => m[1]);
  const sweepTypes = [...sweep.matchAll(/PD_EVENT = "([^"]+)"/g)].map((m) => m[1]);
  const wired = [...new Set([...triggerTypes, ...sweepTypes])];
  const mapped = wired.map((eventType) => mapDispatcherEventToLotI(eventType)).filter(Boolean).sort();
  assert.equal(LOT_I_EVENTS.length, 9);
  assert.equal(mapped.length, 7);
  assert.ok(mapped.includes("PAYMENT_DUE"));
  assert.ok(mapped.includes("PAYMENT_RECEIVED"));
});

test("RED-PD-17 — sweep puis paiement complet → drainOutbox sans notification", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPaymentDueFixtures(pool);
    const obligationId = await insertObligation(pool, { dueDate: "2026-09-05", amountDue: 10000 });
    await withRepo(pool, async (repo) => {
      const store = repo.getClientsStore();
      await sweepPaymentDueOutbox(store, { referenceDate: REF_DATE });
      assert.equal((await outboxForObligation(pool, obligationId)).length, 1);
      await allocatePayment(pool, { obligationId, amount: 10000 });
      await drainOutbox(store, { limit: 10 });
    });
    const noteCount = await pool.query(
      `SELECT count(*)::int c FROM communication_notifications WHERE event_key = $1`,
      [eventKeyForObligation(obligationId)],
    );
    const recipientCount = await pool.query(
      `SELECT count(*)::int c FROM notification_recipients r
       JOIN communication_notifications n ON n.id = r.notification_id
       WHERE n.event_key = $1`,
      [eventKeyForObligation(obligationId)],
    );
    assert.equal(noteCount.rows[0].c, 0, "obligation soldée avant drain → aucune notification");
    assert.equal(recipientCount.rows[0].c, 0);
    const outbox = await pool.query(
      `SELECT status FROM communication_event_outbox WHERE event_key = $1`,
      [eventKeyForObligation(obligationId)],
    );
    assert.equal(outbox.rows[0].status, "processed");
  });
});

test("RED-PD-18 — concurrence réelle : paiement non commité vs drain FOR UPDATE", async () => {
  await withIsolatedPg(async (pool) => {
    await seedPaymentDueFixtures(pool);
    const obligationId = await insertObligation(pool, { dueDate: "2026-09-05", amountDue: 15000 });
    await pool.query(
      `INSERT INTO communication_event_outbox
         (event_key, event_type, school_id, source_entity_type, source_entity_id, payload)
       VALUES ($1,$2,$3,'student_fee_obligation',$4,'{}'::jsonb)`,
      [eventKeyForObligation(obligationId), PD_EVENT, SCHOOL_A, obligationId],
    );

    const payClient = await pool.connect();
    let drainDone = false;
    try {
      await payClient.query("BEGIN");
      const paymentId = randomUUID();
      await payClient.query(
        `INSERT INTO payments (id,school_id,student_id,payment_code,amount,currency,payment_method,payment_status,payment_date,created_by)
         VALUES ($1,$2,$3,$4,$5,'XOF','cash','paid','2026-09-09',$6)`,
        [paymentId, SCHOOL_A, STUDENT_A, `PAY-RACE-${paymentId.slice(0, 8)}`, 15000, ADMIN_A],
      );
      await payClient.query(
        `INSERT INTO payment_allocations (school_id, payment_id, obligation_id, amount) VALUES ($1,$2,$3,$4)`,
        [SCHOOL_A, paymentId, obligationId, 15000],
      );
      const lockedRow = (await payClient.query(
        `SELECT balance, status FROM student_fee_obligations WHERE id = $1`,
        [obligationId],
      )).rows[0];
      assert.equal(Number(lockedRow.balance), 0, "paiement non commité solde l'obligation dans sa transaction");

      const drainPromise = withRepo(pool, async (repo) => {
        await drainOutbox(repo.getClientsStore(), { limit: 10 });
        drainDone = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(drainDone, false, "drain doit attendre le verrou FOR UPDATE du paiement");

      await payClient.query("COMMIT");
      await drainPromise;

      const noteCount = await pool.query(
        `SELECT count(*)::int c FROM communication_notifications WHERE event_key = $1`,
        [eventKeyForObligation(obligationId)],
      );
      const recipientCount = await pool.query(
        `SELECT count(*)::int c FROM notification_recipients r
         JOIN communication_notifications n ON n.id = r.notification_id
         WHERE n.event_key = $1`,
        [eventKeyForObligation(obligationId)],
      );
      assert.equal(noteCount.rows[0].c, 0, "après COMMIT paiement, drain ne notifie pas");
      assert.equal(recipientCount.rows[0].c, 0);
      const outbox = await pool.query(
        `SELECT status FROM communication_event_outbox WHERE event_key = $1`,
        [eventKeyForObligation(obligationId)],
      );
      assert.equal(outbox.rows[0].status, "processed");
    } finally {
      try {
        await payClient.query("ROLLBACK");
      } catch {
        /* ignore if already committed */
      }
      payClient.release();
    }
  });
});
