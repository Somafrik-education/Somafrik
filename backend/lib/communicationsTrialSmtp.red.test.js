"use strict";

/**
 * PR G GREEN — demande d'essai : delivery EMAIL durable (07A–07D).
 * 07E / 07F restent des conservations (échec SMTP ≠ rollback ; honeypot sans lead).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createTrialAccessRequest } = require("./trialAccessRequests");

const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function trialHttpHandler() {
  const server = read("backend/server.js");
  const start = server.indexOf('app.post("/api/public/trial-requests"');
  assert.ok(start >= 0, "POST /api/public/trial-requests introuvable");
  return server.slice(start, start + 700);
}

const VALID = {
  requesterName: "Awa Diop",
  role: "chef_etablissement",
  schoolName: "Groupe scolaire Horizon",
  countryIso: "SN",
  city: "Dakar",
  phone: "+221770000000",
  email: "awa.diop@example.sn",
  studentBand: "100-300",
  consent: true,
};

function memoryRepo() {
  const rows = [];
  const deliveries = [];
  return {
    rows,
    deliveries,
    async findOpenTrialRequest(email, schoolName) {
      return rows.find(
        (row) =>
          String(row.email).toLowerCase() === String(email).toLowerCase() &&
          String(row.schoolName).toLowerCase() === String(schoolName).toLowerCase(),
      );
    },
    async createTrialAccessRequest(row) {
      const created = {
        id: `tar_${rows.length + 1}`,
        publicRef: `ESS-${String(rows.length + 1).padStart(8, "0")}`,
        status: "nouvelle",
        createdAt: "2026-09-08T12:00:00.000Z",
        ...row,
      };
      rows.push(created);
      return created;
    },
    async ensureDelivery(row) {
      const key = String(row.deliveryKey || row.delivery_key || "").trim();
      const existing = deliveries.find((item) => item.deliveryKey === key);
      if (existing) return existing;
      const inserted = {
        deliveryKey: key,
        channel: String(row.channel || "").toUpperCase(),
        payload: row.payload || {},
        status: "pending",
        schoolId: row.schoolId ?? null,
        userId: row.userId ?? null,
      };
      deliveries.push(inserted);
      return inserted;
    },
  };
}

test("RED-COM-07A — le handler trial ne doit plus déclencher notifyTrialAccessRequest / SMTP direct après persist", () => {
  const handler = trialHttpHandler();
  const createSrc = read("backend/lib/trialAccessRequests.js");
  const notifySrc = read("backend/lib/trialAccessRequestNotification.js");

  assert.doesNotMatch(handler, /deferNotification:\s*true/);
  assert.doesNotMatch(createSrc, /notifyTrialAccessRequest/);
  assert.doesNotMatch(createSrc, /setImmediate/);
  assert.doesNotMatch(notifySrc, /nodemailer|createTransport|sendMail/);
});

test("RED-COM-07B — une communication_channel_delivery EMAIL durable est créée avec le lead", async () => {
  const repo = memoryRepo();
  const created = await createTrialAccessRequest(repo, VALID);

  assert.equal(repo.rows.length, 1);
  assert.equal(created.status, "nouvelle");
  const email = repo.deliveries.filter((row) => row.channel === "EMAIL");
  assert.equal(email.length, 1);
  assert.equal(email[0].payload.to, "contact@somafrik.app");
  assert.equal(email[0].schoolId, null);
  assert.equal(email[0].userId, null);
  assert.doesNotMatch(JSON.stringify(email[0].payload), /SMTP_PASSWORD|SMTP_USER|SMTP_HOST/);

  const createSrc = read("backend/lib/trialAccessRequests.js");
  const notifySrc = read("backend/lib/trialAccessRequestNotification.js");
  assert.match(`${createSrc}\n${notifySrc}`, /ensureDelivery|enqueueTrialAccessRequestNotification/);
});

test("RED-COM-07C — delivery_key idempotente stable pour une demande d'essai", () => {
  const createSrc = read("backend/lib/trialAccessRequests.js");
  const notifySrc = read("backend/lib/trialAccessRequestNotification.js");
  const combined = `${createSrc}\n${notifySrc}`;

  assert.match(combined, /delivery_key|deliveryKey/);
  assert.match(combined, /trial\.access\.request:/);
});

test("RED-COM-07D — retry d'une même demande ne doit pas produire plusieurs EMAIL", async () => {
  const repo = memoryRepo();
  await createTrialAccessRequest(repo, VALID);
  await assert.rejects(
    () => createTrialAccessRequest(repo, VALID),
    (error) => error.statusCode === 409,
  );

  const email = repo.deliveries.filter((row) => row.channel === "EMAIL");
  assert.equal(email.length, 1);
  assert.equal(email[0].deliveryKey, "trial.access.request:tar_1:EMAIL");

  const created = repo.rows[0];
  await repo.ensureDelivery({
    deliveryKey: `trial.access.request:${created.id}:EMAIL`,
    channel: "EMAIL",
    payload: { to: "contact@somafrik.app" },
  });
  assert.equal(repo.deliveries.filter((row) => row.channel === "EMAIL").length, 1);

  const createSrc = read("backend/lib/trialAccessRequests.js");
  const notifySrc = read("backend/lib/trialAccessRequestNotification.js");
  assert.match(`${createSrc}\n${notifySrc}`, /ensureDelivery/);
});

test("GREEN-COM-07E — un échec SMTP ne rollback pas le lead et n'influence pas le 201 HTTP", async () => {
  const repo = memoryRepo();
  const created = await createTrialAccessRequest(repo, VALID);
  assert.equal(repo.rows.length, 1);
  assert.equal(created.status, "nouvelle");
  assert.ok(created.publicRef);
  assert.equal(repo.deliveries.length, 1);

  const handler = trialHttpHandler();
  assert.match(handler, /res\.status\(201\)/);
  assert.doesNotMatch(handler, /sendMail|nodemailer|deferNotification/);
  const createSrc = read("backend/lib/trialAccessRequests.js");
  assert.doesNotMatch(createSrc, /sendMail|nodemailer|setImmediate/);
});

test("GREEN-COM-07F — honeypot et consentement invalide : aucun lead, aucune delivery", async () => {
  const honeypotRepo = memoryRepo();
  await createTrialAccessRequest(honeypotRepo, { ...VALID, website: "https://spam.example" });
  assert.equal(honeypotRepo.rows.length, 0);
  assert.equal(honeypotRepo.deliveries.length, 0);

  const invalidRepo = memoryRepo();
  await assert.rejects(
    () => createTrialAccessRequest(invalidRepo, { ...VALID, consent: false }),
    (error) => error.statusCode === 400,
  );
  assert.equal(invalidRepo.rows.length, 0);
  assert.equal(invalidRepo.deliveries.length, 0);
});

test("GREEN-COM-07-c4 — la demande d'essai ne passe pas par processOneEvent / fan-out parallèle", () => {
  const handler = trialHttpHandler();
  const createSrc = read("backend/lib/trialAccessRequests.js");
  const notifySrc = read("backend/lib/trialAccessRequestNotification.js");
  const combined = `${handler}\n${createSrc}\n${notifySrc}`;
  assert.doesNotMatch(combined, /processOneEvent|drainOutbox|fanOutNotificationChannels|communication_event_outbox/);
  assert.doesNotMatch(combined, /@getbrevo|expo-server-sdk|twilio|sendgrid/i);
  assert.doesNotMatch(createSrc, /persistEstablishment|insertSchool|createSchool\(/);
  assert.doesNotMatch(createSrc, /insertUser|createUser|provisionUser/);
  assert.doesNotMatch(createSrc, /upsertSubscription|insertSubscription/);
});

test("GREEN-COM-07-dest — destinataire canonique contact@somafrik.app, pas de secret SMTP dans le lead", () => {
  const copy = read("backend/lib/trialAccessRequestNotification.emailCopy.js");
  assert.match(copy, /TRIAL_REQUEST_NOTIFY_TO:\s*"contact@somafrik\.app"/);
  const fanout = read("backend/lib/communicationChannelFanout.js");
  assert.match(fanout, /MAIL_FROM/);
  const createSrc = read("backend/lib/trialAccessRequests.js");
  assert.doesNotMatch(createSrc, /SMTP_PASSWORD|SMTP_USER|SMTP_HOST/);
  const pg = read("backend/db/postgresRepository.js");
  const insert = pg.slice(
    pg.indexOf("async createTrialAccessRequest(row)"),
    pg.indexOf("async findOpenTrialRequest"),
  );
  assert.doesNotMatch(insert, /SMTP_PASSWORD|MAIL_FROM/);
});
