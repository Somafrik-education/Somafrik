"use strict";

/**
 * P0 Finance — reçu unique multi-libellés :
 * gardes source (pas de fusion élève+date, total serveur, formulaire)
 * + HTTP mémoire (Esther 500+1+40, total client ignoré, refus, annulation).
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = require("node:path").resolve(__dirname, "../..");
const PORT = 19580;
const BASE = `http://127.0.0.1:${PORT}/api`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRepo(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function asRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function assertSourceGuards() {
  const migration = readRepo("backend/db/migrations/20260831_payment_items_canonical.sql");
  const financeSchema = readRepo("backend/db/financeSchema.js");
  const service = readRepo("backend/lib/financeService.js");
  const helpers = readRepo("backend/lib/financePaymentItems.js");
  const modal = readRepo("web/src/components/payments/QuickPaymentModal.tsx");
  const receipt = readRepo("web/src/components/payments/PaymentReceipt.tsx");
  const columns = readRepo("web/src/pages/entity-page/entityColumns.tsx");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS payment_items/);
  assert.match(migration, /JAMAIS de fusion automatique par \(élève, date\)/);
  assert.doesNotMatch(migration, /GROUP BY[\s\S]{0,120}student_id[\s\S]{0,120}payment_date/i);
  assert.doesNotMatch(financeSchema, /GROUP BY[\s\S]{0,120}student_id[\s\S]{0,120}payment_date/i);
  assert.match(migration, /NOT EXISTS \(\s*SELECT 1 FROM payment_items i WHERE i\.payment_id = p\.id/s);

  assert.match(helpers, /mergeByStudentAndDate: false/);
  assert.match(helpers, /backfillStrategy: "one-payment-one-item"/);
  assert.doesNotMatch(service, /payload\.totalAmount/);
  assert.match(service, /const totalAmount = money\(resolvedItems\.reduce/);

  assert.match(modal, /Ajouter un libellé/);
  assert.match(modal, /Enregistrer le paiement/);
  assert.match(modal, /listPaymentStudentOptions/);
  assert.match(modal, /getFinanceCatalog/);
  assert.doesNotMatch(modal, /\|\| ["']Espèces["']/);
  assert.doesNotMatch(modal, /totalAmount:/);
  assert.match(receipt, />Total</);
  assert.match(columns, /payment-items-detail/);
  assert.match(columns, />\s*Reçu\s*</);

  console.log("verify-finance-multi-item-payment: source guards OK");
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
    if (child.exitCode !== null) throw new Error(`Backend exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await wait(250);
  }
  throw new Error("Backend health timeout");
}

async function login(identifier, password, schoolCode) {
  const result = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  let token = result.data.accessToken || result.data.token;
  if (
    (result.data?.user?.mustChangePassword || result.data?.mustChangePassword) &&
    String(password).length >= 8
  ) {
    const changed = await request("/auth/change-password", {
      method: "POST",
      token,
      body: { newPassword: password },
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    token = changed.data.accessToken || changed.data.token || token;
  }
  return token;
}

async function runHttp() {
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      SOMAFRIK_DB_REQUIRED: "false",
      SOMAFRIK_SKIP_DEMO_SEED: "false",
      DATABASE_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(child);
    const adminToken = await login("admin", "1234", "CD-2026-0001");
    const stamp = Date.now();

    const { prepareCanonicalClassContext, postCanonicalClass } = require("../lib/canonicalClassHttp");
    const offering = await prepareCanonicalClassContext(request, {
      schoolCode: "CD-2026-0001",
      countryCode: "CD",
      groupCode: "MI",
    });
    const createdClass = await postCanonicalClass(request, adminToken, {
      academicYearId: offering.academicYear.id,
      levelId: offering.level.id,
      groupId: offering.group.id,
      status: "active",
    });
    assert.equal(createdClass.status, 201, JSON.stringify(createdClass.data));
    const enrolled = await request(`/classes/${encodeURIComponent(createdClass.data.classCode)}/students`, {
      method: "POST",
      token: adminToken,
      body: { firstName: "Esther", lastName: `Okito${stamp}`, gender: "Féminin", birthDate: "2012-03-01" },
    });
    assert.equal(enrolled.status, 201, JSON.stringify(enrolled.data));
    const studentCode = enrolled.data.student?.studentCode ?? enrolled.data.studentCode;
    const studentId = enrolled.data.student?.id ?? enrolled.data.id ?? studentCode;

    const listBefore = asRows((await request("/payments", { token: adminToken })).data);
    const estherItems = [
      { feeType: "Minerval / scolarité", amount: 500 },
      { feeType: "Frais d'examen", amount: 1 },
      { feeType: "Frais de cantine", amount: 40 },
    ];
    const created = await request("/payments", {
      method: "POST",
      token: adminToken,
      body: {
        studentId,
        items: estherItems,
        paymentMethod: "cash",
        paidAt: "2026-08-19",
        totalAmount: 1,
        amount: 1,
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.totalAmount, 541, "total serveur 541, total client ignoré");
    assert.equal(created.data.amount, 541);
    assert.equal(created.data.items?.length, 3);
    assert.equal(created.data.itemCount, 3);
    assert.equal(created.data.itemsDetail, "3 libellés");
    assert.ok(created.data.reference, "une seule référence");

    const listAfter = asRows((await request("/payments", { token: adminToken })).data);
    const sameRef = listAfter.filter((row) => row.reference === created.data.reference);
    assert.equal(sameRef.length, 1, "une ligne liste par reçu");
    assert.equal(listAfter.length, listBefore.length + 1, "payments +1 seulement");
    assert.equal(sameRef[0].itemsDetail, "3 libellés");
    assert.equal(sameRef[0].totalAmount ?? sameRef[0].amount, 541);

    const fetched = await request(`/payments/${encodeURIComponent(created.data.reference)}`, {
      token: adminToken,
    });
    assert.equal(fetched.status, 200, JSON.stringify(fetched.data));
    assert.equal(fetched.data.items?.length, 3);
    assert.equal(fetched.data.totalAmount, 541);

    const empty = await request("/payments", {
      method: "POST",
      token: adminToken,
      body: { studentId, items: [], paymentMethod: "Espèces", paidAt: "2026-08-19" },
    });
    assert.equal(empty.status, 400, JSON.stringify(empty.data));
    assert.equal(empty.data.code, "PAYMENT_ITEMS_REQUIRED");

    const zero = await request("/payments", {
      method: "POST",
      token: adminToken,
      body: {
        studentId,
        items: [{ feeType: "Minerval / scolarité", amount: 0 }],
        paymentMethod: "Espèces",
        paidAt: "2026-08-19",
      },
    });
    assert.equal(zero.status, 400, JSON.stringify(zero.data));
    assert.equal(zero.data.code, "PAYMENT_ITEM_AMOUNT_INVALID");

    const foreign = await request("/payments", {
      method: "POST",
      token: adminToken,
      body: {
        studentId,
        items: [{ feeTypeId: "00000000-0000-4000-8000-000000000099", amount: 10 }],
        paymentMethod: "Espèces",
        paidAt: "2026-08-19",
      },
    });
    assert.ok([400, 403, 404].includes(foreign.status), JSON.stringify(foreign.data));
    assert.ok(
      ["FEE_ITEM_NOT_FOUND", "FEE_ITEM_TENANT_MISMATCH"].includes(foreign.data?.code),
      JSON.stringify(foreign.data),
    );

    const cancelled = await request(`/payments/${encodeURIComponent(created.data.reference)}/cancel`, {
      method: "POST",
      token: adminToken,
      body: { reason: "Annulation reçu complet" },
    });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
    assert.equal(cancelled.data.status, "Annulé");
    assert.equal(cancelled.data.itemCount, 3);
    assert.equal(cancelled.data.items?.length, 3);

    const listAfterCancel = asRows((await request("/payments", { token: adminToken })).data);
    assert.equal(
      listAfterCancel.filter((row) => row.reference === created.data.reference).length,
      1,
      "annulation = un seul reçu, pas trois",
    );

    console.log("verify-finance-multi-item-payment: HTTP OK");
  } finally {
    child.kill("SIGTERM");
    await wait(300);
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  assertSourceGuards();
  await runHttp();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
