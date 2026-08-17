"use strict";

/**
 * LOT 4 — preuve de clôture Finance :
 * - PUT /backoffice/state refuse toute présence d'une clé Finance avant merge ;
 * - paiements / grilles / reminders passent par les APIs PostgreSQL ;
 * - state Finance est une projection de lecture ;
 * - aucun writer Web/Mobile/BackOffice ne renvoie les clés Finance au snapshot.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { assertBackOfficeStateReadRemoved, assertBackOfficeStateWriteRemoved } = require("../lib/backofficeStatePutExpectation");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19573;
const BASE = `http://127.0.0.1:${PORT}/api`;

const {
  FINANCE_STATE_KEYS,
  LEGACY_FINANCE_STATE_WRITE_CODE,
  LEGACY_FINANCE_STATE_WRITE_MESSAGE,
  stripLegacyFinanceStateWrite,
} = require("../lib/legacyFinanceStateWrite");
const {
  evaluateBackOfficeWriteAccess,
  getWritableBackOfficeEntitiesForPrincipal,
} = require("../lib/backOfficeWritableEntities");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(pathname, { method = "GET", token, body, headers } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function waitForHealth(child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Backend exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await wait(250);
  }
  throw new Error("Backend health timeout");
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) return "";
  const next = source.indexOf("\nfunction ", start + 10);
  return source.slice(start, next < 0 ? source.length : next);
}

function extractRoute(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const next = source.indexOf("\napp.", start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

function runUnitGuards() {
  for (const role of ["Admin School", "Secrétaire", "Comptable", "Directeur"]) {
    for (const key of FINANCE_STATE_KEYS) {
      assert.equal(
        getWritableBackOfficeEntitiesForPrincipal({ role }).includes(key),
        false,
        `${role}: ${key} hors matrice PUT`,
      );
    }
  }
  assert.equal(
    getWritableBackOfficeEntitiesForPrincipal(
      { role: "Super Administrateur Somafrik" },
      [...FINANCE_STATE_KEYS, "users", "auditLog"],
    ).includes("payments"),
    false,
    "Super Admin: payments hors matrice PUT",
  );
  assert.equal(
    evaluateBackOfficeWriteAccess(
      { role: "Comptable", schoolCode: "CD-2026-0001" },
      ["payments"],
      ["payments", "users"],
    ).ok,
    false,
  );

  const mixed = stripLegacyFinanceStateWrite({
    payments: [],
    users: [{ id: "USER-SENTINEL" }],
    feeGrids: null,
  });
  assert.equal(mixed.rejectLegacyFinanceWrite, true);
  assert.deepEqual(mixed.rejectedKeys, ["feeGrids", "payments"]);

  const server = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  assert.match(server, /BACKOFFICE_STATE_WRITE_REMOVED_CODE/);
  assert.match(server, /overlayFinanceProjection/);
  assert.doesNotMatch(
    server,
    /applyAtomicPayment\(.*saveBackOfficeState|saveBackOfficeState\(.*payments/,
  );

  const paymentsPost = extractRoute(server, 'app.post("/api/payments"');
  assert.match(paymentsPost, /financeAuditMetaFromRequest/);
  assert.match(paymentsPost, /createSchoolPayment/);
  assert.doesNotMatch(paymentsPost, /auditService\.record/);

  const paymentsCancel = extractRoute(server, 'app.post("/api/payments/:paymentId/cancel"');
  assert.match(paymentsCancel, /financeAuditMetaFromRequest/);
  assert.match(paymentsCancel, /cancelSchoolPayment/);
  assert.doesNotMatch(paymentsCancel, /auditService\.record/);

  const financeService = fs.readFileSync(path.join(ROOT, "backend/lib/financeService.js"), "utf8");
  assert.match(financeService, /async function writeFinanceAudit\(tx,/);
  assert.match(financeService, /await writeFinanceAudit\(tx, principal, auditMeta,/);
  assert.match(financeService, /tx\.recordFinanceAudit/);

  const pgStore = fs.readFileSync(path.join(ROOT, "backend/db/financePgStore.js"), "utf8");
  assert.match(pgStore, /cancelled_by = \$3::uuid/);
  assert.match(pgStore, /INSERT INTO audit_logs/);
  assert.match(pgStore, /FOR UPDATE OF p/);

  const postgres = fs.readFileSync(path.join(ROOT, "backend/db/postgresRepository.js"), "utf8");
  const saveState = postgres.match(/async saveBackOfficeState[\s\S]*?^  \}/m);
  assert.ok(saveState, "saveBackOfficeState présent");
  assert.match(postgres, /async getBackOfficeState\(\)[\s\S]*return null/);
  assert.match(saveState[0], /createBackOfficeStateWriteRemovedError/);

  const webContext = fs.readFileSync(path.join(ROOT, "web/src/context/DataContext.tsx"), "utf8");
  assert.match(webContext, /stripClientFinanceFromPutPayload/);

  const mobileApi = fs.readFileSync(path.join(ROOT, "Mobile/src/services/api.ts"), "utf8");
  assert.match(mobileApi, /BACKOFFICE_STATE_READ_REMOVED/);

  const mobileContext = fs.readFileSync(path.join(ROOT, "Mobile/src/context/AdminDataContext.tsx"), "utf8");
  assert.match(mobileContext, /entity === "payments"/);

  const legacyBackOffice = fs.readFileSync(path.join(ROOT, "BackOffice/app.js"), "utf8");
  assert.doesNotMatch(legacyBackOffice, /\/backoffice\/state/);
  assert.doesNotMatch(legacyBackOffice, /payments:\s*state\.payments/);

  console.log("OK unit: Finance hors PUT state et clients legacy");
}

async function loginAdmin() {
  const login = await request("/backoffice/login", {
    method: "POST",
    body: { identifier: "admin", password: "1234", schoolCode: "CD-2026-0001" },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const token = login.data.accessToken || login.data.token;
  assert.ok(token);
  return token;
}

async function runHttpGuards() {
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      SOMAFRIK_DB_REQUIRED: "false",
      DATABASE_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForHealth(child);
    const token = await loginAdmin();
    const stamp = Date.now();

    const usersBefore = await request("/backoffice/users", { token });
    assert.equal(usersBefore.status, 200);
    const baselineUserCount = Array.isArray(usersBefore.data) ? usersBefore.data.length : 0;

    assertBackOfficeStateReadRemoved(await request("/backoffice/state", { token }));

    for (const key of FINANCE_STATE_KEYS) {
      const rejected = await request("/backoffice/state", {
        method: "PUT",
        token,
        body: { [key]: [] },
      });
      assertBackOfficeStateWriteRemoved(rejected);
    }

    const userSentinelId = `USER-LOT4-${stamp}`;
    const mixed = await request("/backoffice/state", {
      method: "PUT",
      token,
      body: {
        payments: null,
        feeGrids: {},
        users: [
          ...(usersBefore.data ?? []),
          {
            id: userSentinelId,
            name: "Sentinel Lot 4",
            role: "Admin School",
            schoolCode: "CD-2026-0001",
          },
        ],
      },
    });
    assertBackOfficeStateWriteRemoved(mixed);

    const usersAfter = await request("/backoffice/users", { token });
    assert.equal(usersAfter.status, 200);
    assert.equal(
      (usersAfter.data ?? []).some((row) => String(row.id) === userSentinelId),
      false,
      "aucune mutation partielle users",
    );

    const { prepareCanonicalClassContext, postCanonicalClass } = require("../lib/canonicalClassHttp");
    const offering = await prepareCanonicalClassContext(request, {
      schoolCode: "CD-2026-0001",
      countryCode: "CD",
      groupCode: "L4",
    });
    const createdClass = await postCanonicalClass(request, token, {
      academicYearId: offering.academicYear.id,
      levelId: offering.level.id,
      groupId: offering.group.id,
      status: "active",
    });
    assert.equal(createdClass.status, 201, JSON.stringify(createdClass.data));
    const enrolled = await request(`/classes/${encodeURIComponent(createdClass.data.classCode)}/students`, {
      method: "POST",
      token,
      body: { firstName: "Awa", lastName: `LotQuatre${stamp}`, gender: "Féminin", birthDate: "2012-04-12" },
    });
    assert.equal(enrolled.status, 201, JSON.stringify(enrolled.data));
    const studentCode = enrolled.data.student?.studentCode ?? enrolled.data.studentCode;

    const grid = await request("/finance/fee-grids", {
      method: "POST",
      token,
      body: {
        className: createdClass.data.name,
        academicYear: "2025-2026",
        currency: "CDF",
        items: [{ feeType: "Inscription", label: "Inscription", amount: 25_000, dueDate: "2026-01-01", status: "Actif" }],
      },
    });
    assert.equal(grid.status, 201, JSON.stringify(grid.data));
    const activated = await request(`/finance/fee-grids/${encodeURIComponent(grid.data.id)}/activate`, {
      method: "POST",
      token,
    });
    assert.equal(activated.status, 200, JSON.stringify(activated.data));
    const applied = await request(`/finance/fee-grids/${encodeURIComponent(grid.data.id)}/apply`, {
      method: "POST",
      token,
      headers: { "Idempotency-Key": `lot4-apply-${stamp}` },
    });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    assert.ok(applied.data.created >= 1);

    const payment = await request("/payments", {
      method: "POST",
      token,
      headers: { "Idempotency-Key": `lot4-pay-${stamp}` },
      body: {
        studentId: studentCode,
        feeType: "Inscription",
        amount: 25_000,
        method: "Espèces",
        date: "2026-08-13",
        schoolCode: "BI-2026-0001",
        createdBy: "forged",
      },
    });
    assert.equal(payment.status, 201, JSON.stringify(payment.data));
    assert.match(String(payment.data.reference), /PAY-/);

    const replay = await request("/payments", {
      method: "POST",
      token,
      headers: { "Idempotency-Key": `lot4-pay-${stamp}` },
      body: {
        studentId: studentCode,
        feeType: "Inscription",
        amount: 25_000,
        method: "Espèces",
        date: "2026-08-13",
      },
    });
    assert.equal(replay.status, 201, JSON.stringify(replay.data));
    assert.equal(replay.data.reference, payment.data.reference);

    const projected = await request("/payments", { token });
    assert.equal(projected.status, 200);
    assert.ok(
      (projected.data ?? []).some((row) => row.reference === payment.data.reference),
      "GET /payments projette le paiement PostgreSQL",
    );

    console.log("OK http: APIs Finance PG + PUT fail-closed");
  } finally {
    child.kill("SIGTERM");
    await wait(200);
    if (stderr && process.env.DEBUG_LEGACY_FINANCE) {
      console.error(stderr);
    }
  }
}

async function main() {
  runUnitGuards();
  await runHttpGuards();
}

if (process.env.SOMAFRIK_VERIFY_FINANCE_UNIT_ONLY === "true") {
  try {
    runUnitGuards();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
} else {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
