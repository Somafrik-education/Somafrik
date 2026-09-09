"use strict";

/**
 * AUDIT-COM-FINAL — audit final Communications H→K avant GO production.
 * Base auditée : develop@a9400c26acd89d102b551edad8025df37efc325e (#562).
 * Ce fichier n'est pas un RED : il fige les contrats runtime observés et les écarts P1/P2 connus.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const { applyAtomicPayment } = require("../services/paymentTransactionService");
const {
  createMemoryDeliveryAdapter,
  enqueueChannelDeliveries,
  drainChannelDeliveries,
  deliveryKey,
  MAX_ATTEMPTS,
  STALE_LEASE_MS,
  STALE_PROCESSING_REASON,
  STALE_LEASE_RECLAIMED,
  sanitizeDeliveryLastError,
  summarizeChannelDeliveryHealth,
} = require("./communicationChannelFanout");
const {
  canReadDeliveryHealth,
  resolveDeliveryHealthScope,
  readDeliveryHealth,
} = require("./communicationsDeliveryHealth");
const {
  resolveEffectiveChannels,
  mandatoryChannelsForEvent,
} = require("./communicationsDispatcher");
const {
  LOT_I_EVENTS,
  mapDispatcherEventToLotI,
} = require("./schoolNotificationPolicy");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");

const RETRY_BASE_MS = 5000;
const RETRY_CAP_MS = 15 * 60 * 1000;

function retryDelayMs(attempts) {
  const exp = Math.max(0, Number(attempts) || 0);
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.min(exp, 10));
}

const ROOT = path.resolve(__dirname, "../..");
const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const NOTE_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const EVENT_KEY = "attendance.student.absent:dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const TOKEN_A = "ExponentPushToken[school-a-final-audit]";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function outboxEventTypesFromSchema() {
  const schema = read("backend/db/communicationsNotificationsSchema.js");
  const block = schema.slice(schema.indexOf("somafrik_enqueue_communication_event"), schema.indexOf("$$ LANGUAGE plpgsql"));
  const matches = [...block.matchAll(/v_event_type := '([^']+)'/g)].map((m) => m[1]);
  const sweep = read("backend/lib/communicationsPaymentDueSweep.js");
  const sweepTypes = [...sweep.matchAll(/PD_EVENT = "([^"]+)"/g)].map((m) => m[1]);
  return [...new Set([...matches, ...sweepTypes])].sort();
}

function envPreprod(extra = {}) {
  return {
    NODE_ENV: "test",
    APP_ENV: "preproduction",
    SMTP_HOST: "smtp.test.local",
    MAIL_FROM: "noreply@somafrik.app",
    ...extra,
  };
}

function createPushStore(devices) {
  return {
    async listActiveForUser({ userId, schoolId, backendEnvironment }) {
      return devices.filter(
        (item) =>
          item.user_id === userId &&
          item.school_id === schoolId &&
          item.backend_environment === backendEnvironment &&
          !item.revoked_at,
      );
    },
  };
}

function baseNote(schoolId = SCHOOL_A) {
  return {
    id: NOTE_ID,
    event_key: EVENT_KEY,
    event_type: "attendance.student.absent",
    school_id: schoolId,
    title: "Absence enregistrée",
    body: "Un élève a été signalé(e) absent(e).",
  };
}

test("AUDIT-COM-FINAL-01 — architecture : quatre familles séparées", () => {
  const c4 = read("backend/db/communicationsNotificationsSchema.js");
  const c3 = read("backend/db/communicationsAnnouncementsSchema.js");
  const platform = read("backend/db/platformAnnouncementsSchema.js");
  const legacy = read("backend/db/schema.sql");
  const service = read("backend/lib/communicationsNotificationsService.js");
  const server = read("backend/server.js");

  assert.match(c4, /communication_notifications/);
  assert.match(c4, /notification_recipients/);
  assert.match(c4, /communication_channel_deliveries/);
  assert.match(legacy, /CREATE TABLE IF NOT EXISTS notifications \(/);
  assert.match(legacy, /CREATE TABLE IF NOT EXISTS announcements \(/);
  assert.match(c3, /CREATE TABLE IF NOT EXISTS announcement_recipients \(/);
  assert.match(platform, /CREATE TABLE IF NOT EXISTS platform_announcements \(/);
  assert.doesNotMatch(service, /INTO notifications /);
  assert.match(server, /\/api\/backoffice\/internal-notifications/);
  assert.match(server, /\/api\/backoffice\/communications\/deliveries\/health/);
});

test("AUDIT-COM-FINAL-01b — matrice événements : 8/9 Lot I câblés, 1/9 sans producteur (P1 connu)", () => {
  const wired = outboxEventTypesFromSchema();
  assert.deepEqual(wired, [
    "attendance.student.absent",
    "attendance.student.late",
    "communication.announcement.published",
    "communication.message.created",
    "finance.payment.due",
    "finance.payment.recorded",
    "pedagogy.grade.published",
    "pedagogy.report_card.published",
    "planning.timetable.changed",
  ]);

  const mappedPolicy = wired
    .map((eventType) => mapDispatcherEventToLotI(eventType))
    .filter(Boolean)
    .sort();
  assert.equal(LOT_I_EVENTS.length, 9, "Lot I canonique = 9 événements (LOT_I_EVENTS + CHECK PostgreSQL)");
  assert.equal(mappedPolicy.length, 8, "8/9 événements Lot I ont un producteur outbox");
  assert.deepEqual(mappedPolicy, [
    "ANNOUNCEMENT_PUBLISHED",
    "GRADE_PUBLISHED",
    "PAYMENT_DUE",
    "PAYMENT_RECEIVED",
    "REPORT_CARD_PUBLISHED",
    "STUDENT_ABSENT",
    "STUDENT_LATE",
    "TIMETABLE_CHANGED",
  ]);

  const missingProducers = LOT_I_EVENTS.filter(
    (key) => !mappedPolicy.includes(key),
  ).sort();
  assert.deepEqual(missingProducers, [
    "TEACHER_REPLACEMENT",
  ]);
});

test("AUDIT-COM-FINAL-02 — isolation tenant : Expo ne cible pas un token école B pour user A école A", async () => {
  const targeted = [];
  const adapter = createMemoryDeliveryAdapter({
    notifications: [baseNote(SCHOOL_A)],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
  });
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  await drainChannelDeliveries(adapter, {
    pushStore: createPushStore([
      {
        user_id: USER_A,
        school_id: SCHOOL_A,
        expo_push_token: TOKEN_A,
        backend_environment: "preproduction",
      },
      {
        user_id: USER_A,
        school_id: SCHOOL_B,
        expo_push_token: "ExponentPushToken[school-b-final-audit]",
        backend_environment: "preproduction",
      },
    ]),
    pushClient: {
      async sendToTokens(tokens) {
        targeted.push(...tokens);
        return { sent: tokens.length };
      },
    },
    mailer: { async sendMail() {} },
    env: envPreprod(),
  });
  assert.deepEqual(targeted, [TOKEN_A]);
  assert.equal(targeted.includes("ExponentPushToken[school-b-final-audit]"), false);
});

test("AUDIT-COM-FINAL-03 — isolation pays : Admin Pays CD ne voit pas BI", async () => {
  const adapter = createMemoryDeliveryAdapter({
    schools: [
      { id: SCHOOL_A, countryCode: "CD" },
      { id: SCHOOL_B, countryCode: "BI" },
    ],
  });
  await adapter.ensureDelivery({
    deliveryKey: "final:cd:push",
    eventKey: "cd.event",
    notificationId: null,
    schoolId: SCHOOL_A,
    userId: USER_A,
    channel: "PUSH",
    payload: {},
  });
  await adapter.ensureDelivery({
    deliveryKey: "final:bi:push",
    eventKey: "bi.event",
    notificationId: null,
    schoolId: SCHOOL_B,
    userId: USER_B,
    channel: "PUSH",
    payload: {},
  });
  adapter.deliveries.find((row) => row.school_id === SCHOOL_B).status = "failed";

  const cd = await readDeliveryHealth(adapter, {
    role: "Admin Pays",
    roleKeys: ["COUNTRY_ADMIN"],
    countryCode: "CD",
    countryScope: "RDC",
    platformContext: { kind: "country", countryCode: "CD" },
  });
  assert.equal(cd.counts.failed, 0);
  assert.deepEqual(resolveDeliveryHealthScope({ role: "Admin Pays", roleKeys: ["COUNTRY_ADMIN"], countryCode: "CD", countryScope: "BI" }), {
    mode: "none",
  });
});

test("AUDIT-COM-FINAL-04 — RBAC diagnostic deliveries", async () => {
  assert.equal(canReadDeliveryHealth({ role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"] }), true);
  assert.equal(canReadDeliveryHealth({ role: "Parent", roleKeys: ["PARENT"], schoolId: SCHOOL_A }), false);
  assert.deepEqual(
    resolveDeliveryHealthScope({ role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolId: SCHOOL_A }),
    { mode: "school", schoolId: SCHOOL_A },
  );
  await assert.rejects(
    () => readDeliveryHealth({ async listDeliveryHealth() { return {}; } }, { role: "Admin School", roleKeys: ["SCHOOL_ADMIN"] }),
    (error) => error.statusCode === 403,
  );
});

test("AUDIT-COM-FINAL-05 — school policy AND user preference", () => {
  assert.deepEqual(
    resolveEffectiveChannels({
      eventType: "attendance.student.absent",
      userEnabledChannels: ["IN_APP", "PUSH", "EMAIL"],
    }),
    ["PUSH", "EMAIL"],
  );
  assert.deepEqual(
    resolveEffectiveChannels({
      eventType: "attendance.student.absent",
      userEnabledChannels: ["PUSH"],
    }),
    ["PUSH"],
  );
  assert.deepEqual(mandatoryChannelsForEvent("auth.password.reset"), ["EMAIL"]);
  assert.deepEqual(
    resolveEffectiveChannels({
      eventType: "auth.password.reset",
      userEnabledChannels: [],
    }),
    ["EMAIL"],
  );
});

test("AUDIT-COM-FINAL-06 — idempotence delivery_key (mémoire + concurrence)", async () => {
  const adapter = createMemoryDeliveryAdapter({
    notifications: [baseNote()],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
  });
  const key = deliveryKey(EVENT_KEY, USER_A, "PUSH");
  assert.equal(key, `${EVENT_KEY}:${USER_A}:PUSH`);
  const first = await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  const second = await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  assert.equal(first, 2);
  assert.equal(second, 0);
  assert.equal(adapter.deliveries.length, 2);

  if (!DATABASE_URL) {
    return;
  }

  const dbName = `somafrik_audit_final_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new Pool({ connectionString: DATABASE_URL.replace(/\/[^/]+$/, "/postgres") });
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const pool = new Pool({ connectionString: DATABASE_URL.replace(/\/[^/]+$/, `/${dbName}`) });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(read("backend/db/schema.sql"));
    await ensureClientsCanonicalBootstrap(pool, { info() {}, error() {} });
    const school = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const schoolRow = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status) VALUES ($1, 'AUDIT-FINAL', 'Audit Final', 'active') RETURNING id`,
      [school.rows[0].id],
    );
    const user = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, role, status) VALUES ($1, 'USR-AF', 'A', 'B', 'parent', 'active') RETURNING id`,
      [schoolRow.rows[0].id],
    );
    const deliveryKeyValue = `audit.final:${user.rows[0].id}:PUSH`;
    const insertSql = `INSERT INTO communication_channel_deliveries
      (delivery_key, event_key, school_id, user_id, channel, status, payload, available_at)
      VALUES ($1, $2, $3, $4, 'PUSH', 'pending', '{}'::jsonb, NOW())
      ON CONFLICT (delivery_key) DO NOTHING
      RETURNING id`;
    const params = [deliveryKeyValue, EVENT_KEY, schoolRow.rows[0].id, user.rows[0].id];
    const [a, b] = await Promise.all([
      pool.query(insertSql, params),
      pool.query(insertSql, params),
    ]);
    const created = [a.rowCount, b.rowCount].filter((count) => count > 0).length;
    assert.equal(created, 1, "UNIQUE delivery_key : un seul INSERT concurrent réussi");
    const count = await pool.query(
      `SELECT count(*)::int AS c FROM communication_channel_deliveries WHERE delivery_key = $1`,
      [deliveryKeyValue],
    );
    assert.equal(count.rows[0].c, 1);
  } finally {
    await pool.end();
    const drop = new Pool({ connectionString: DATABASE_URL.replace(/\/[^/]+$/, "/postgres") });
    await drop.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await drop.end();
  }
});

test("AUDIT-COM-FINAL-07 — retry, backoff et dead_letter", async () => {
  assert.equal(retryDelayMs(0), RETRY_BASE_MS);
  assert.equal(retryDelayMs(1), RETRY_BASE_MS * 2);
  assert.ok(retryDelayMs(20) <= RETRY_CAP_MS);

  const adapter = createMemoryDeliveryAdapter({
    notifications: [baseNote()],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
  });
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  adapter.deliveries.find((row) => row.channel === "EMAIL").status = "skipped";
  let calls = 0;
  const base = Date.now();
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    await drainChannelDeliveries(
      adapter,
      {
        pushStore: createPushStore([
          {
            user_id: USER_A,
            school_id: SCHOOL_A,
            expo_push_token: TOKEN_A,
            backend_environment: "preproduction",
          },
        ]),
        pushClient: {
          async sendToTokens() {
            calls += 1;
            throw new Error("Expo 503");
          },
        },
        mailer: { async sendMail() {} },
        env: envPreprod(),
        now: () => new Date(base + i * 16 * 60 * 1000),
      },
    );
  }
  const push = adapter.deliveries.find((row) => row.channel === "PUSH");
  assert.equal(push.status, "dead_letter");
  assert.equal(calls, MAX_ATTEMPTS);
  const later = new Date(base + MAX_ATTEMPTS * 16 * 60 * 1000);
  await drainChannelDeliveries(
    adapter,
    {
      pushStore: createPushStore([
        {
          user_id: USER_A,
          school_id: SCHOOL_A,
          expo_push_token: TOKEN_A,
          backend_environment: "preproduction",
        },
      ]),
      pushClient: {
        async sendToTokens() {
          calls += 1;
          return { sent: 1 };
        },
      },
      mailer: { async sendMail() {} },
      env: envPreprod(),
      now: () => later,
    },
  );
  assert.equal(calls, MAX_ATTEMPTS, "dead_letter n'est plus claimed");
});

test("AUDIT-COM-FINAL-08 — stale worker cas A (sans dispatch_started_at) et cas B (avec)", async () => {
  const adapterA = createMemoryDeliveryAdapter({
    notifications: [baseNote()],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
  });
  await enqueueChannelDeliveries(adapterA, [{ event_key: EVENT_KEY }]);
  adapterA.deliveries.find((row) => row.channel === "EMAIL").status = "skipped";
  const claimedA = await adapterA.claimDue();
  assert.equal(claimedA.dispatch_started_at || null, null);
  let sentA = 0;
  const laterA = new Date(Date.now() + STALE_LEASE_MS + 1000);
  await drainChannelDeliveries(adapterA, {
    pushStore: createPushStore([
      {
        user_id: USER_A,
        school_id: SCHOOL_A,
        expo_push_token: TOKEN_A,
        backend_environment: "preproduction",
      },
    ]),
    pushClient: {
      async sendToTokens(tokens) {
        sentA += 1;
        assert.deepEqual(tokens, [TOKEN_A]);
        return { sent: 1 };
      },
    },
    mailer: { async sendMail() {} },
    env: envPreprod(),
    now: () => laterA,
  });
  const pushA = adapterA.deliveries.find((row) => row.channel === "PUSH");
  assert.equal(sentA, 1, "cas A : un seul envoi après reclaim stale sans dispatch_started_at");
  assert.equal(pushA.status, "sent");

  let sentB = 0;
  const adapterB = createMemoryDeliveryAdapter({
    notifications: [baseNote()],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
  });
  await enqueueChannelDeliveries(adapterB, [{ event_key: EVENT_KEY }]);
  adapterB.deliveries.find((row) => row.channel === "EMAIL").status = "skipped";
  const claimedB = await adapterB.claimDue();
  await adapterB.markDispatchStarted(claimedB.id);
  const stuck = adapterB.deliveries.find((row) => row.channel === "PUSH");
  const laterB = new Date(Date.now() + STALE_LEASE_MS + 1000);
  await drainChannelDeliveries(adapterB, {
    pushStore: createPushStore([
      {
        user_id: USER_A,
        school_id: SCHOOL_A,
        expo_push_token: TOKEN_A,
        backend_environment: "preproduction",
      },
    ]),
    pushClient: {
      async sendToTokens() {
        sentB += 1;
        return { sent: 1 };
      },
    },
    mailer: { async sendMail() {} },
    env: envPreprod(),
    now: () => laterB,
  });
  assert.equal(sentB, 0, "cas B : pas de second send");
  assert.equal(stuck.status, "skipped");
  assert.equal(stuck.last_error, STALE_PROCESSING_REASON);
});

test("AUDIT-COM-FINAL-09 — sanitization PII diagnostic deliveries", () => {
  const dirty =
    "SMTP timeout parent@test.local Bearer secret123 ExponentPushToken[abc] SMTP_PASSWORD leaked";
  const clean = sanitizeDeliveryLastError(dirty);
  assert.doesNotMatch(clean, /parent@test\.local/);
  assert.doesNotMatch(clean, /ExponentPushToken/);
  assert.doesNotMatch(clean, /Bearer/);
  assert.doesNotMatch(clean, /SMTP_PASSWORD/);

  const snapshot = summarizeChannelDeliveryHealth([
    {
      channel: "EMAIL",
      status: "failed",
      attempts: 2,
      last_error: dirty,
      payload: { to: "parent@test.local", delivery_key: "secret" },
      delivery_key: "evt:user:EMAIL",
      user_id: USER_A,
    },
  ]);
  const json = JSON.stringify(snapshot);
  assert.doesNotMatch(json, /parent@test\.local/);
  assert.doesNotMatch(json, /delivery_key/);
  assert.doesNotMatch(json, /"payload"/);
});

test("AUDIT-COM-FINAL-10 — legacy double-write : paiement n'alimente pas catalogue B", () => {
  const existing = [{ id: "LEGACY-1", status: "Non lu", title: "Catalogue" }];
  const state = {
    students: [{ id: "stu-1", firstName: "A", lastName: "B", schoolCode: "SCH-1" }],
    schools: [{ code: "SCH-1", currency: "CDF" }],
    payments: [],
    studentFees: [],
    notifications: existing,
    auditLog: [],
  };
  const { nextState } = applyAtomicPayment(
    state,
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
  assert.equal(nextState.payments.length, 1);
});

test("AUDIT-COM-FINAL-11 — PostgreSQL migrations Communications alignées bootstrap", () => {
  const schema = read("backend/db/communicationsNotificationsSchema.js");
  const bootstrap = read("backend/db/clientsCanonicalBootstrap.js");
  const channelMigration = read("backend/db/migrations/20260907_communication_channel_deliveries.sql");
  const reliabilityMigration = read("backend/db/migrations/20260908_communication_channel_deliveries_reliability.sql");
  const prefsMigration = read("backend/db/migrations/20260910_user_communication_preferences.sql");
  const policyMigration = read("backend/db/migrations/20260912_school_notification_settings.sql");

  assert.match(schema, /delivery_key\s+TEXT\s+NOT NULL\s+UNIQUE/);
  assert.match(channelMigration, /delivery_key\s+TEXT\s+NOT NULL\s+UNIQUE/);
  assert.match(reliabilityMigration, /dispatch_started_at/);
  assert.match(reliabilityMigration, /dead_letter/);
  assert.match(bootstrap, /applyCommunicationsC4Schema/);
  assert.match(prefsMigration, /user_communication_preferences/);
  assert.match(policyMigration, /school_notification_settings/);
  assert.match(schema, /idx_communication_channel_deliveries_pending/);
});

test("AUDIT-COM-FINAL-12 — Web/Mobile routing séparé C4 vs catalogue plateforme", () => {
  const { spawnSync } = require("node:child_process");
  const mobile = spawnSync("npx", ["--yes", "tsx", "Mobile/src/lib/notificationInboxRoute.test.ts"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (mobile.stdout) process.stdout.write(mobile.stdout);
  if (mobile.stderr) process.stderr.write(mobile.stderr);
  assert.equal(mobile.status, 0, "Mobile notificationInboxRoute");

  const webPage = read("web/src/pages/NotificationsPage.tsx");
  const catalog = read("web/src/pages/PlatformNotificationsPage.tsx");
  const app = read("web/src/App.tsx");
  assert.match(webPage, /InternalNotificationsCenter/);
  assert.doesNotMatch(webPage, /platformApi/);
  assert.match(catalog, /platformApi\.createNotification/);
  assert.match(app, /path="\/notifications"/);
  assert.match(app, /path="\/notifications-plateforme"/);
});
