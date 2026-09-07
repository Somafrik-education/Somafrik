"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const SERVER = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
const SCHEMA = fs.readFileSync(path.join(ROOT, "backend/db/schema.sql"), "utf8");
const RBAC = fs.readFileSync(path.join(ROOT, "backend/services/rbacService.js"), "utf8");
const GUARD = fs.readFileSync(path.join(ROOT, "backend/lib/platformPersonalDataGuard.js"), "utf8");
const PLATFORM = fs.readFileSync(path.join(ROOT, "backend/lib/platformService.js"), "utf8");

function loadTrialModule() {
  try {
    return require("./trialAccessRequests");
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") return null;
    throw error;
  }
}

const trial = loadTrialModule();

test("RED — POST /api/public/trial-requests est déclaré sans requireAuth", () => {
  assert.match(SERVER, /app\.post\("\/api\/public\/trial-requests"/);
  const start = SERVER.indexOf('app.post("/api/public/trial-requests"');
  assert.ok(start >= 0);
  const snippet = SERVER.slice(start, start + 500);
  assert.doesNotMatch(snippet, /requireAuth/);
  assert.match(snippet, /RateLimiter|rateLimiter|createRateLimiter/);
});

test("RED — GET /api/backoffice/trial-requests exige l'auth Superadmin", () => {
  assert.match(SERVER, /app\.get\("\/api\/backoffice\/trial-requests"/);
  const start = SERVER.indexOf('app.get("/api/backoffice/trial-requests"');
  const snippet = SERVER.slice(start, start + 450);
  assert.match(snippet, /requireAuth/);
  assert.match(snippet, /requirePermission\("GET \/api\/backoffice\/trial-requests"\)/);
  assert.match(RBAC, /"GET \/api\/backoffice\/trial-requests"/);
  const rbacLine = RBAC.split("\n").find((line) => line.includes('"GET /api/backoffice/trial-requests"'));
  assert.ok(rbacLine);
  assert.match(rbacLine, /ALL_PRIVILEGES/);
  assert.doesNotMatch(rbacLine, /Frais|Contacts:READ|SCHOOL_ADMIN/);
});

test("RED — GET trial-requests est une fonction plateforme autorisée, pas un deny PII scolaire", () => {
  const allowedStart = GUARD.indexOf("const PLATFORM_ADMIN_ALLOWED");
  const allowedBlock = GUARD.slice(allowedStart, GUARD.indexOf("]);", allowedStart) + 2);
  const denyStart = GUARD.indexOf("const SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM");
  const denyBlock = GUARD.slice(denyStart, allowedStart);
  assert.match(allowedBlock, /GET \/api\/backoffice\/trial-requests/);
  assert.doesNotMatch(denyBlock, /GET \/api\/backoffice\/trial-requests/);
});

test("RED — table PostgreSQL trial_access_requests + un seul essai par établissement", () => {
  assert.match(SCHEMA, /CREATE TABLE IF NOT EXISTS trial_access_requests/);
  assert.match(SCHEMA, /consent_at/);
  assert.match(SCHEMA, /status TEXT NOT NULL DEFAULT 'nouvelle'/);
  assert.match(SCHEMA, /trial_used|one_trial|unique_trial|trialUsed/);
});

test("RED — module createTrialAccessRequest : consentement obligatoire", async () => {
  assert.ok(trial, "backend/lib/trialAccessRequests.js manquant");
  await assert.rejects(
    () =>
      trial.createTrialAccessRequest(
        {},
        {
          requesterName: "Amina Proviseur",
          role: "chef_etablissement",
          schoolName: "Complexe Scolaire Nuru",
          countryIso: "CD",
          city: "Kinshasa",
          phone: "+243800000000",
          email: "amina@nuru.cd",
          studentBand: "100-300",
          consent: false,
        },
      ),
    (error) => error.statusCode === 400,
  );
});

test("RED — POST public persiste une demande sans créer schools/users/subscriptions", async () => {
  assert.ok(trial, "backend/lib/trialAccessRequests.js manquant");
  const counts = { schools: 2, users: 9, subscriptions: 3 };
  const repo = {
    counts,
    async createTrialAccessRequest(row) {
      this.inserted = row;
      return { id: "tr-1", publicRef: "TRIAL-1", status: "nouvelle", ...row };
    },
    async countSchools() {
      return this.counts.schools;
    },
    async countUsers() {
      return this.counts.users;
    },
    async countSubscriptions() {
      return this.counts.subscriptions;
    },
  };
  const created = await trial.createTrialAccessRequest(repo, {
    requesterName: "Amina Proviseur",
    role: "chef_etablissement",
    schoolName: "Complexe Scolaire Nuru",
    countryIso: "CD",
    city: "Kinshasa",
    phone: "+243800000000",
    email: "amina@nuru.cd",
    studentBand: "100-300",
    consent: true,
  });
  assert.equal(created.status, "nouvelle");
  assert.equal(await repo.countSchools(), 2);
  assert.equal(await repo.countUsers(), 9);
  assert.equal(await repo.countSubscriptions(), 3);
  const source = fs.readFileSync(path.join(ROOT, "backend/lib/trialAccessRequests.js"), "utf8");
  assert.doesNotMatch(source, /persistEstablishment|insertSchool|createSchool\(/);
  assert.doesNotMatch(source, /insertUser|createUser|provisionUser/);
  assert.doesNotMatch(source, /upsertSubscription|insertSubscription/);
});

test("RED — anti-doublon email+établissement → 409", async () => {
  assert.ok(trial, "backend/lib/trialAccessRequests.js manquant");
  const payload = {
    requesterName: "Amina Proviseur",
    role: "chef_etablissement",
    schoolName: "Complexe Scolaire Nuru",
    countryIso: "CD",
    city: "Kinshasa",
    phone: "+243800000000",
    email: "amina@nuru.cd",
    studentBand: "100-300",
    consent: true,
  };
  const store = [];
  const repo = {
    async findOpenTrialRequest(email, schoolName) {
      return store.find(
        (row) =>
          String(row.email).toLowerCase() === String(email).toLowerCase() &&
          String(row.schoolName).toLowerCase() === String(schoolName).toLowerCase(),
      );
    },
    async createTrialAccessRequest(row) {
      store.push(row);
      return { id: `tr-${store.length}`, status: "nouvelle", ...row };
    },
  };
  await trial.createTrialAccessRequest(repo, payload);
  await assert.rejects(
    () => trial.createTrialAccessRequest(repo, payload),
    (error) => error.statusCode === 409,
  );
});

test("RED — listTrialAccessRequests : anonyme 401, établissement 403, Superadmin 200", async () => {
  assert.ok(trial, "backend/lib/trialAccessRequests.js manquant");
  await assert.rejects(() => trial.listTrialAccessRequests({ rows: [] }, null), (error) => error.statusCode === 401);
  await assert.rejects(
    () =>
      trial.listTrialAccessRequests(
        { rows: [] },
        { role: "Admin School", schoolCode: "CD-2026-0001", roleKeys: ["SCHOOL_ADMIN"] },
      ),
    (error) => error.statusCode === 403,
  );
  const listed = await trial.listTrialAccessRequests(
    { rows: [{ id: "tr-1", status: "nouvelle" }] },
    { role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"], permissions: ["ALL_PRIVILEGES"] },
  );
  assert.equal(listed.length, 1);
});

test("RED — un second Essai pour le même établissement est refusé côté Backend", () => {
  assert.match(
    PLATFORM,
    /assertSchoolTrialNotAlreadyUsed|TRIAL_ALREADY_USED|essai déjà utilisé/,
  );
});

test("GREEN — aucun fichier Mobile n'implémente la demande d'essai", () => {
  const mobileRoot = path.join(ROOT, "Mobile");
  const hits = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx)$/.test(entry)) continue;
      const text = fs.readFileSync(full, "utf8");
      if (/trial-requests|demande-essai|Demander 1 mois d.essai/.test(text)) hits.push(path.relative(ROOT, full));
    }
  }
  walk(mobileRoot);
  assert.deepEqual(hits, []);
});
