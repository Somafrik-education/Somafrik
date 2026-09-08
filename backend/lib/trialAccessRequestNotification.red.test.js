"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createTrialAccessRequest } = require("./trialAccessRequests");
const {
  buildTrialRequestNotificationEmail,
  buildTrialRequestDeliveryPayload,
  enqueueTrialAccessRequestNotification,
  trialAccessRequestDeliveryKey,
} = require("./trialAccessRequestNotification");
const { EXPECTED_TRIAL_REQUEST_EMAIL } = require("./trialAccessRequestNotification.emailCopy");
const {
  createMemoryDeliveryAdapter,
  drainChannelDeliveries,
} = require("./communicationChannelFanout");

function memoryRepo() {
  const rows = [];
  return {
    rows,
    async createTrialAccessRequest(row) {
      const created = {
        id: `tar_${rows.length + 1}`,
        publicRef: `ESS-${String(rows.length + 1).padStart(8, "0")}`,
        status: "nouvelle",
        createdAt: "2026-09-07T12:00:00.000Z",
        ...row,
      };
      rows.push(created);
      return created;
    },
  };
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

test("createTrialAccessRequest enqueue une delivery EMAIL vers contact@somafrik.app après persistance", async () => {
  const repo = memoryRepo();
  const deliveries = [];
  repo.ensureDelivery = async (row) => {
    deliveries.push(row);
    return row;
  };
  const created = await createTrialAccessRequest(repo, VALID);

  assert.equal(repo.rows.length, 1);
  assert.equal(created.status, "nouvelle");
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].channel, "EMAIL");
  assert.equal(deliveries[0].payload.to, "contact@somafrik.app");
  assert.equal(deliveries[0].deliveryKey, trialAccessRequestDeliveryKey(created.id));
  assert.equal(deliveries[0].payload.kind, "trial.access.request");
});

test("l’e-mail de notification contient les champs prospect et la référence publique", () => {
  const mail = buildTrialRequestNotificationEmail({
    publicRef: "ESS-00000042",
    requesterName: VALID.requesterName,
    role: VALID.role,
    schoolName: VALID.schoolName,
    countryIso: VALID.countryIso,
    city: VALID.city,
    phone: VALID.phone,
    email: VALID.email,
    studentBand: VALID.studentBand,
  });

  assert.equal(mail.to, "contact@somafrik.app");
  assert.equal(mail.subject, EXPECTED_TRIAL_REQUEST_EMAIL.subject("Groupe scolaire Horizon"));
  assert.equal(mail.text, EXPECTED_TRIAL_REQUEST_EMAIL.text({
    publicRef: "ESS-00000042",
    requesterName: VALID.requesterName,
    role: VALID.role,
    schoolName: VALID.schoolName,
    countryIso: VALID.countryIso,
    city: VALID.city,
    phone: VALID.phone,
    email: VALID.email,
    studentBand: VALID.studentBand,
  }));
  assert.equal(mail.attachments, undefined);
});

test("une panne SMTP au drain ne rollback pas la demande déjà persistée", async () => {
  const adapter = createMemoryDeliveryAdapter({ users: [] });
  const repo = memoryRepo();
  repo.ensureDelivery = adapter.ensureDelivery.bind(adapter);
  const created = await createTrialAccessRequest(repo, VALID);
  assert.equal(repo.rows.length, 1);
  assert.equal(created.status, "nouvelle");

  await drainChannelDeliveries(adapter, {
    mailer: {
      async sendMail() {
        throw new Error("SMTP down");
      },
    },
    env: {
      SMTP_HOST: "smtp.test.local",
      MAIL_FROM: "notifications@somafrik.app",
    },
  });
  assert.equal(repo.rows.length, 1);
  assert.equal(adapter.deliveries[0].status, "failed");
});

test("honeypot / spam : aucune notification e-mail", async () => {
  const repo = memoryRepo();
  const deliveries = [];
  repo.ensureDelivery = async (row) => {
    deliveries.push(row);
    return row;
  };
  await createTrialAccessRequest(repo, { ...VALID, website: "https://spam.example" });
  assert.equal(repo.rows.length, 0);
  assert.equal(deliveries.length, 0);
});

test("source: POST public persiste une intention EMAIL durable, sans SMTP HTTP", () => {
  const src = fs.readFileSync(path.join(__dirname, "./trialAccessRequests.js"), "utf8");
  assert.match(src, /enqueueTrialAccessRequestNotification/);
  assert.match(src, /withTransaction/);
  assert.doesNotMatch(src, /notifyTrialRequest|deferNotification|setImmediate/);
  const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const start = server.indexOf('app.post("/api/public/trial-requests"');
  const snippet = server.slice(start, start + 500);
  assert.doesNotMatch(snippet, /deferNotification/);
  assert.match(snippet, /res\.status\(201\)/);
});

test("le module de notification ne crée ni school, ni user, ni subscription", () => {
  const file = path.join(__dirname, "./trialAccessRequestNotification.js");
  assert.equal(fs.existsSync(file), true, "backend/lib/trialAccessRequestNotification.js manquant");
  const src = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(src, /persistEstablishment|insertSchool|createSchool\(/);
  assert.doesNotMatch(src, /insertUser|createUser|provisionUser/);
  assert.doesNotMatch(src, /upsertSubscription|insertSubscription/);
  assert.doesNotMatch(src, /nodemailer|sendMail|createTransport/);
});

test("le payload de delivery n'embarque aucun secret SMTP", () => {
  const payload = buildTrialRequestDeliveryPayload({
    id: "tar_1",
    publicRef: "ESS-00000001",
    ...VALID,
  });
  const blob = JSON.stringify(payload);
  assert.doesNotMatch(blob, /SMTP_PASSWORD|SMTP_USER|SMTP_HOST|MAIL_FROM/i);
  assert.equal(payload.to, "contact@somafrik.app");
  assert.equal(payload.kind, "trial.access.request");
});

test("enqueue + drain EMAIL une seule fois vers contact@somafrik.app", async () => {
  const adapter = createMemoryDeliveryAdapter({ users: [] });
  const request = { id: "tar_99", publicRef: "ESS-00000099", ...VALID };
  const first = await enqueueTrialAccessRequestNotification(adapter, request);
  const second = await enqueueTrialAccessRequestNotification(adapter, request);
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(adapter.deliveries.length, 1);

  const mails = [];
  const deps = {
    mailer: {
      async sendMail(message) {
        mails.push(message);
      },
    },
    env: {
      SMTP_HOST: "smtp.test.local",
      MAIL_FROM: "notifications@somafrik.app",
    },
  };
  await drainChannelDeliveries(adapter, deps);
  await drainChannelDeliveries(adapter, deps);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "contact@somafrik.app");
  assert.equal(adapter.deliveries[0].status, "sent");
});

test("Compose transmet SMTP_HOST et MAIL_FROM au backend", () => {
  const root = path.join(__dirname, "../..");
  for (const file of [
    "docker-compose.yml",
    "docker-compose.preprod.yml",
    "docker-compose.production.yml",
  ]) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(src, /SMTP_HOST:/, `${file} sans SMTP_HOST`);
    assert.match(src, /MAIL_FROM:/, `${file} sans MAIL_FROM`);
    assert.match(src, /TRIAL_REQUEST_NOTIFY_TO:/, `${file} sans TRIAL_REQUEST_NOTIFY_TO`);
  }
});

test("la clé de rate limit des demandes d'essai est l'IP, pas l'e-mail", () => {
  const { trialRequestRateLimitKey } = require("./rateLimit");
  const sameIpA = trialRequestRateLimitKey({ ip: "203.0.113.8", body: { email: "a@ecole.sn" } });
  const sameIpB = trialRequestRateLimitKey({ ip: "203.0.113.8", body: { email: "b@lycee.ci" } });
  assert.equal(sameIpA, "trial-request:203.0.113.8");
  assert.equal(sameIpA, sameIpB);
});

test("Mobile inchangé pour la notification e-mail", () => {
  const walk = (dir, acc = []) => {
    if (!fs.existsSync(dir)) return acc;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory() && ent.name !== "node_modules") walk(p, acc);
      else if (ent.isFile()) acc.push(p);
    }
    return acc;
  };
  const hits = walk(path.join(__dirname, "../../Mobile")).filter((f) => {
    const c = fs.readFileSync(f, "utf8");
    return /trial-requests|trialAccessRequest|demande-essai/i.test(c);
  });
  assert.equal(hits.length, 0);
});
