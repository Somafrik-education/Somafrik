"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createTrialAccessRequest } = require("./trialAccessRequests");
const { EXPECTED_TRIAL_REQUEST_EMAIL } = require("./trialAccessRequestNotification.emailCopy");

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

test("createTrialAccessRequest tente une notification vers contact@somafrik.app après persistance", async () => {
  const repo = memoryRepo();
  const calls = [];
  const created = await createTrialAccessRequest(repo, VALID, {
    notifyTrialRequest: async (payload) => {
      calls.push(payload);
    },
  });

  assert.equal(repo.rows.length, 1);
  assert.equal(created.status, "nouvelle");
  assert.equal(calls.length, 1, "la notification doit être tentée après l'insert");
  assert.equal(calls[0].publicRef, created.publicRef);
  assert.equal(calls[0].requesterName, VALID.requesterName);
  assert.equal(calls[0].role, VALID.role);
  assert.equal(calls[0].schoolName, VALID.schoolName);
  assert.equal(calls[0].countryIso, VALID.countryIso);
  assert.equal(calls[0].city, VALID.city);
  assert.equal(calls[0].phone, VALID.phone);
  assert.equal(calls[0].email, VALID.email);
  assert.equal(calls[0].studentBand, VALID.studentBand);
});

test("l’e-mail de notification contient les champs prospect et la référence publique", () => {
  const {
    buildTrialRequestNotificationEmail,
  } = require("./trialAccessRequestNotification");
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

test("une panne du mailer ne rollback pas la demande PostgreSQL", async () => {
  const repo = memoryRepo();
  let attempted = false;
  const created = await createTrialAccessRequest(repo, VALID, {
    notifyTrialRequest: async () => {
      attempted = true;
      throw new Error("SMTP down");
    },
  });

  assert.equal(attempted, true, "la notification doit être tentée même si le transport échoue");
  assert.equal(repo.rows.length, 1);
  assert.equal(created.status, "nouvelle");
  assert.ok(created.publicRef);
});

test("honeypot / spam : aucune notification e-mail", async () => {
  const repo = memoryRepo();
  const calls = [];
  await createTrialAccessRequest(
    repo,
    { ...VALID, website: "https://spam.example" },
    {
      notifyTrialRequest: async (payload) => {
        calls.push(payload);
      },
    },
  );
  assert.equal(repo.rows.length, 0);
  assert.equal(calls.length, 0);
});

test("source: POST public persiste puis notifie, sans rollback", () => {
  const src = fs.readFileSync(path.join(__dirname, "./trialAccessRequests.js"), "utf8");
  assert.match(src, /notifyTrialRequest/);
  assert.match(src, /createTrialAccessRequest\(/);
});

test("le module de notification ne crée ni school, ni user, ni subscription", () => {
  const file = path.join(__dirname, "./trialAccessRequestNotification.js");
  assert.equal(fs.existsSync(file), true, "backend/lib/trialAccessRequestNotification.js manquant");
  const src = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(src, /persistEstablishment|insertSchool|createSchool\(/);
  assert.doesNotMatch(src, /insertUser|createUser|provisionUser/);
  assert.doesNotMatch(src, /upsertSubscription|insertSubscription/);
});

test("notifyTrialAccessRequest ne jette pas si SMTP est absent", async () => {
  const prevHost = process.env.SMTP_HOST;
  const prevFrom = process.env.MAIL_FROM;
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_FROM;
  const { notifyTrialAccessRequest } = require("./trialAccessRequestNotification");
  await notifyTrialAccessRequest({
    ...VALID,
    publicRef: "ESS-00000001",
  });
  if (prevHost === undefined) delete process.env.SMTP_HOST;
  else process.env.SMTP_HOST = prevHost;
  if (prevFrom === undefined) delete process.env.MAIL_FROM;
  else process.env.MAIL_FROM = prevFrom;
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
