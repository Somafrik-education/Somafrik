"use strict";

/**
 * LOT 4 — parcours Finance HTTP (mémoire) : RBAC, annulation, cooldown, isolation.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { canCancelPayment, cancelPayment } = require("../lib/financeService");

const ROOT = require("node:path").resolve(__dirname, "../..");
const PORT = 19574;
const BASE = `http://127.0.0.1:${PORT}/api`;

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

async function main() {
  assert.equal(
    canCancelPayment({ permissions: ["Paiements:CREATE"] }),
    false,
    "Paiements:CREATE seul ne doit jamais autoriser l'annulation",
  );
  assert.equal(canCancelPayment({ permissions: ["Paiements:UPDATE"] }), true);
  assert.equal(canCancelPayment({ permissions: ["Gérer paiements"] }), true);
  assert.equal(canCancelPayment({ permissions: ["ALL_PRIVILEGES"] }), true);

  let transactionEntered = false;
  await assert.rejects(
    () =>
      cancelPayment(
        {
          withTransaction: async () => {
            transactionEntered = true;
            throw new Error("la transaction ne doit pas être atteinte");
          },
        },
        "PAY-TEST",
        "Correction de saisie",
        { permissions: ["Paiements:CREATE"], schoolCode: "CD-2026-0001" },
        {},
      ),
    (error) => error?.statusCode === 403 && /Paiements:UPDATE/.test(String(error?.message ?? "")),
  );
  assert.equal(transactionEntered, false, "refus avant toute mutation Finance");

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
  try {
    await waitForHealth(child);
    const adminToken = await login("admin", "1234", "CD-2026-0001");
    const stamp = Date.now();

    const { prepareCanonicalClassContext, postCanonicalClass } = require("../lib/canonicalClassHttp");
    const offering = await prepareCanonicalClassContext(request, {
      schoolCode: "CD-2026-0001",
      countryCode: "CD",
      groupCode: "FN",
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
      body: { firstName: "Lina", lastName: `Finance${stamp}`, gender: "Féminin", birthDate: "2011-09-01" },
    });
    assert.equal(enrolled.status, 201, JSON.stringify(enrolled.data));
    const studentCode = enrolled.data.student?.studentCode ?? enrolled.data.studentCode;

    const grid = await request("/finance/fee-grids", {
      method: "POST",
      token: adminToken,
      body: {
        className: createdClass.data.name,
        academicYear: "2025-2026",
        currency: "CDF",
        items: [{ feeType: "Inscription", label: "Inscription", amount: 10_000, dueDate: "2026-01-01", status: "Actif" }],
      },
    });
    assert.equal(grid.status, 201, JSON.stringify(grid.data));
    await request(`/finance/fee-grids/${encodeURIComponent(grid.data.id)}/activate`, { method: "POST", token: adminToken });
    await request(`/finance/fee-grids/${encodeURIComponent(grid.data.id)}/apply`, { method: "POST", token: adminToken });

    const accountantUser = {
      id: `USER-CPT-${stamp}`,
      firstName: "Compta",
      lastName: "Lot4",
      role: "Comptable",
      identifier: `cpt-lot4-${stamp}`,
      schoolCode: "CD-2026-0001",
      status: "Actif",
      password: "E2eTest!2026",
      temporaryPassword: "E2eTest!2026",
    };
    const secretaryUser = {
      id: `USER-SEC-${stamp}`,
      firstName: "Secre",
      lastName: "Lot4",
      role: "Secrétaire",
      identifier: `sec-lot4-${stamp}`,
      schoolCode: "CD-2026-0001",
      status: "Actif",
      password: "E2eTest!2026",
      temporaryPassword: "E2eTest!2026",
    };
    const directorUser = {
      id: `USER-DIR-${stamp}`,
      firstName: "Direc",
      lastName: "Lot4",
      role: "Directeur",
      identifier: `dir-lot4-${stamp}`,
      schoolCode: "CD-2026-0001",
      status: "Actif",
      password: "E2eTest!2026",
      temporaryPassword: "E2eTest!2026",
    };
    async function createStaffUser(userPayload) {
      const created = await request("/backoffice/users", {
        method: "POST",
        token: adminToken,
        body: {
          firstName: userPayload.firstName,
          lastName: userPayload.lastName,
          status: userPayload.status,
          temporaryPassword: userPayload.temporaryPassword || userPayload.password,
        },
      });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const granted = await request(`/backoffice/users/${created.data.id}/roles/grant`, {
        method: "POST",
        token: adminToken,
        body: { role: userPayload.role },
      });
      assert.equal(granted.status, 200, JSON.stringify(granted.data));
      return { ...created.data, ...granted.data };
    }

    const accountant = await createStaffUser(accountantUser);
    const secretary = await createStaffUser(secretaryUser);
    const director = await createStaffUser(directorUser);

    const accountantToken = await login(accountant.identifier, "E2eTest!2026", "CD-2026-0001");
    const secretaryToken = await login(secretary.identifier, "E2eTest!2026", "CD-2026-0001");
    const directorToken = await login(director.identifier, "E2eTest!2026", "CD-2026-0001");
    const superToken = await login("superadmin", "1234");
    const prefetToken = await login("prefet", "1234", "CD-2026-0001");
    const teacherToken = await login("ENS-0001", "1234", "CD-2026-0001");

    const accountantGrid = await request("/finance/fee-grids", {
      method: "POST",
      token: accountantToken,
      body: {
        className: createdClass.data.name,
        academicYear: "2024-2025",
        currency: "CDF",
        items: [{ feeType: "Annexe", label: "Cantine", amount: 5_000, status: "Actif" }],
      },
    });
    assert.equal(accountantGrid.status, 403, "Comptable ne gère pas les grilles");

    const pay = await request("/payments", {
      method: "POST",
      token: accountantToken,
      body: {
        studentId: studentCode,
        feeType: "Inscription",
        amount: 10_000,
        method: "Espèces",
        date: "2026-08-13",
      },
    });
    assert.equal(pay.status, 201, JSON.stringify(pay.data));

    const cancel = await request(`/payments/${encodeURIComponent(pay.data.reference)}/cancel`, {
      method: "POST",
      token: accountantToken,
      body: { reason: "Trop perçu" },
    });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
    assert.equal(cancel.data.status, "Annulé");

    const fees = await request("/finance/student-fees", { token: adminToken });
    assert.equal(fees.status, 200);
    const obligation = (Array.isArray(fees.data) ? fees.data : fees.data?.items ?? []).find(
      (row) => row.studentId === studentCode || row.studentId === enrolled.data.student?.id || row.studentId === enrolled.data.id,
    );
    assert.ok(obligation, "obligation projetée");

    const secretaryAdjust = await request(`/finance/student-fees/${encodeURIComponent(obligation.id)}/adjust`, {
      method: "POST",
      token: secretaryToken,
      body: { exemption: 10_000 },
    });
    assert.equal(secretaryAdjust.status, 403, "Secrétaire n'ajuste pas les obligations");

    const reminder = await request(`/backoffice/finance/unpaid/${encodeURIComponent(studentCode)}/reminders`, {
      method: "POST",
      token: accountantToken,
      body: { channel: "notification", recipient: "Parent" },
    });
    assert.equal(reminder.status, 201, JSON.stringify(reminder.data));
    const cooldown = await request(`/backoffice/finance/unpaid/${encodeURIComponent(studentCode)}/reminders`, {
      method: "POST",
      token: accountantToken,
      body: { channel: "notification", recipient: "Parent" },
    });
    assert.equal(cooldown.status, 409, JSON.stringify(cooldown.data));
    assert.equal(cooldown.data?.code, "REMINDER_COOLDOWN");
    const forced = await request(`/backoffice/finance/unpaid/${encodeURIComponent(studentCode)}/reminders`, {
      method: "POST",
      token: accountantToken,
      body: { channel: "notification", recipient: "Parent", force: true },
    });
    assert.equal(forced.status, 403, JSON.stringify(forced.data));
    assert.equal(forced.data?.code, "REMINDER_FORCE_FORBIDDEN");

    const superGrid = await request("/finance/fee-grids", {
      method: "POST",
      token: superToken,
      body: {
        schoolCode: "CD-2026-0001",
        className: createdClass.data.name,
        academicYear: "2023-2024",
        currency: "CDF",
        items: [{ feeType: "Annexe", label: "SuperAdmin", amount: 1_000, status: "Actif" }],
      },
    });
    assert.equal(superGrid.status, 201, JSON.stringify(superGrid.data));

    const directorPay = await request("/payments", {
      method: "POST",
      token: directorToken,
      body: {
        studentId: studentCode,
        feeType: "Inscription",
        amount: 1,
        method: "Espèces",
        date: "2026-08-13",
      },
    });
    assert.equal(directorPay.status, 201, JSON.stringify(directorPay.data));

    const paymentBody = {
      studentId: studentCode,
      feeType: "Inscription",
      amount: 1,
      method: "Espèces",
      date: "2026-08-13",
    };
    const prefetPay = await request("/payments", { method: "POST", token: prefetToken, body: paymentBody });
    assert.equal(prefetPay.status, 403, "Préfet n'écrit pas les paiements");
    const teacherPay = await request("/payments", { method: "POST", token: teacherToken, body: paymentBody });
    assert.equal(teacherPay.status, 403, "Enseignant n'écrit pas les paiements");

    const crossTenant = await request("/payments", {
      method: "POST",
      token: accountantToken,
      body: {
        studentId: "BI-2026-0001-STU-0001",
        feeType: "Inscription",
        amount: 10,
        method: "Espèces",
        date: "2026-08-13",
        schoolCode: "BI-2026-0001",
        createdBy: "forged-actor",
      },
    });
    assert.equal(crossTenant.status, 404, JSON.stringify(crossTenant.data));
    assert.equal(crossTenant.data?.code, "STUDENT_NOT_FOUND");

    const secretaryPay = await request("/payments", {
      method: "POST",
      token: secretaryToken,
      body: {
        studentId: studentCode,
        feeType: "Inscription",
        amount: 1,
        method: "Espèces",
        date: "2026-08-13",
        schoolId: "other-school",
        country: "BI",
        createdBy: "forged",
      },
    });
    assert.equal(secretaryPay.status, 201, JSON.stringify(secretaryPay.data));
    assert.match(String(secretaryPay.data.reference), /^CD-2026-0001-\d{4}-PAY-/);

    console.log("OK http: RBAC Finance + annulation + cooldown");
  } finally {
    child.kill("SIGTERM");
    await wait(200);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
