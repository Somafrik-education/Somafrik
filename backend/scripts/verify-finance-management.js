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
      SOMAFRIK_SKIP_DEMO_SEED: "false",
      DATABASE_URL: "",
      DB_HOST: "",
      DB_USER: "",
      DB_PASSWORD: "",
      DB_NAME: "",
      POSTGRES_HOST: "",
      POSTGRES_USER: "",
      POSTGRES_PASSWORD: "",
      POSTGRES_DB: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const childLogs = [];
  child.stdout.on("data", (chunk) => childLogs.push(String(chunk)));
  child.stderr.on("data", (chunk) => childLogs.push(String(chunk)));
  try {
    await waitForHealth(child);
    let adminToken;
    try {
      adminToken = await login("admin", "1234", "CD-2026-0001");
    } catch (error) {
      error.message = `${error.message}\n--- backend ---\n${childLogs.join("")}`;
      throw error;
    }
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

    const accountantStudents = await request("/students", { token: accountantToken });
    assert.equal(accountantStudents.status, 403, "Comptable n'a pas GET /students");

    const accountantOptions = await request("/finance/payment-student-options", { token: accountantToken });
    assert.equal(accountantOptions.status, 200, JSON.stringify(accountantOptions.data));
    const optionRows = Array.isArray(accountantOptions.data) ? accountantOptions.data : accountantOptions.data?.items ?? [];
    assert.ok(optionRows.some((row) => row.studentCode === studentCode || row.studentId), "Comptable voit l'élève inscrit");
    assert.equal(
      optionRows.every((row) => !("parentPhone" in row) && !("parentEmail" in row)),
      true,
      "projection minimale sans parent",
    );

    const teacherOptions = await request("/finance/payment-student-options", { token: teacherToken });
    assert.equal(teacherOptions.status, 403, "Enseignant n'a pas payment-student-options");

    const catalog = await request("/finance/catalog", { token: accountantToken });
    assert.equal(catalog.status, 200, JSON.stringify(catalog.data));
    assert.equal(catalog.data.currency, "CDF");
    assert.equal(Array.isArray(catalog.data.paymentMethods), true);
    assert.equal(catalog.data.discountsDeferred, true);

    const accountantPutMethods = await request("/finance/payment-methods", {
      method: "PUT",
      token: accountantToken,
      body: { methods: [{ methodCode: "cash", label: "Espèces", active: true }] },
    });
    assert.equal(accountantPutMethods.status, 403, "Comptable ne configure pas les moyens");

    const adminPutMethods = await request("/finance/payment-methods", {
      method: "PUT",
      token: adminToken,
      body: {
        methods: [
          { methodCode: "cash", label: "Espèces", active: true },
          { methodCode: "mobile_money", label: "Mobile money", active: true },
        ],
      },
    });
    assert.equal(adminPutMethods.status, 200, JSON.stringify(adminPutMethods.data));
    assert.equal(adminPutMethods.data.some((row) => row.methodCode === "cash" && row.active), true);

    function asFinanceRows(payload) {
      if (Array.isArray(payload)) return payload;
      if (Array.isArray(payload?.items)) return payload.items;
      return [];
    }
    const injectedScope = "?schoolCode=BI-2026-0002&schoolId=00000000-0000-0000-0000-0000000000bb";
    const injectedOptions = await request(`/finance/payment-student-options${injectedScope}`, {
      token: accountantToken,
    });
    assert.equal(injectedOptions.status, 200, JSON.stringify(injectedOptions.data));
    const injectedOptionRows = asFinanceRows(injectedOptions.data);
    assert.equal(
      injectedOptionRows.every((row) => !String(row.studentCode || row.studentId || "").includes("BI-")),
      true,
      "query/tenant B n'élargit jamais payment-student-options A",
    );

    const injectedCatalog = await request(`/finance/catalog${injectedScope}`, { token: accountantToken });
    assert.equal(injectedCatalog.status, 200, JSON.stringify(injectedCatalog.data));
    assert.equal(injectedCatalog.data.currency, "CDF", "query B ne change pas la devise A");

    const adminBiToken = await login("admin", "1234", "BI-2026-0002");
    const forgedMethods = await request("/finance/payment-methods", {
      method: "PUT",
      token: adminToken,
      body: {
        schoolCode: "BI-2026-0002",
        schoolId: "00000000-0000-0000-0000-0000000000bb",
        methods: [{ methodCode: "card", label: "Carte injectée", active: true }],
      },
    });
    assert.equal(forgedMethods.status, 200, JSON.stringify(forgedMethods.data));
    assert.equal(
      asFinanceRows(forgedMethods.data).some((row) => row.methodCode === "card" && row.persisted),
      true,
      "le PUT s'applique au tenant du principal A",
    );

    const methodsBi = await request("/finance/payment-methods", { token: adminBiToken });
    assert.equal(methodsBi.status, 200, JSON.stringify(methodsBi.data));
    assert.equal(
      asFinanceRows(methodsBi.data).every(
        (row) => !(row.methodCode === "card" && row.persisted === true && row.label === "Carte injectée"),
      ),
      true,
      "body schoolCode/schoolId B ne mute jamais B",
    );

    const optionsBi = await request("/finance/payment-student-options", { token: adminBiToken });
    assert.equal(optionsBi.status, 200, JSON.stringify(optionsBi.data));
    assert.equal(
      asFinanceRows(optionsBi.data).every((row) => !String(row.studentCode || "").startsWith("CD-")),
      true,
      "Admin B ne voit pas les élèves A",
    );

    const accountantGrid = await request("/finance/fee-grids", {
      method: "POST",
      token: accountantToken,
      body: {
        className: createdClass.data.name,
        academicYear: "2024-2025",
        currency: "CDF",
        items: [{ feeType: "Cantine", label: "Cantine", amount: 5_000, status: "Actif" }],
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
        items: [{ feeType: "Autre", label: "SuperAdmin", amount: 1_000, status: "Actif" }],
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

    const rateStudent = await request(`/classes/${encodeURIComponent(createdClass.data.classCode)}/students`, {
      method: "POST",
      token: adminToken,
      body: { firstName: "Koffi", lastName: `Rate${stamp}`, gender: "Masculin", birthDate: "2012-03-01" },
    });
    assert.equal(rateStudent.status, 201, JSON.stringify(rateStudent.data));
    const rateStudentCode = rateStudent.data.student?.studentCode ?? rateStudent.data.studentCode;
    const mensualiteGrid = await request("/finance/fee-grids", {
      method: "POST",
      token: adminToken,
      body: {
        className: createdClass.data.name,
        academicYear: "2026-2027",
        currency: "CDF",
        items: [
          {
            feeType: "Mensualité",
            label: "Mensualité",
            amount: 100,
            monthlyMonths: ["Janvier", "Février", "Mars", "Avril", "Mai"],
            dueDate: "2026-01-01",
            status: "Actif",
          },
        ],
      },
    });
    assert.equal(mensualiteGrid.status, 201, JSON.stringify(mensualiteGrid.data));
    await request(`/finance/fee-grids/${encodeURIComponent(mensualiteGrid.data.id)}/activate`, {
      method: "POST",
      token: adminToken,
    });
    const applied = await request(`/finance/fee-grids/${encodeURIComponent(mensualiteGrid.data.id)}/apply`, {
      method: "POST",
      token: adminToken,
      body: { studentIds: [rateStudentCode] },
    });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    const scolaritePay = await request("/payments", {
      method: "POST",
      token: accountantToken,
      body: {
        studentId: rateStudentCode,
        items: [{ feeType: "Scolarité", amount: 100 }],
        method: "Espèces",
        date: "2026-08-24",
      },
    });
    assert.equal(scolaritePay.status, 201, JSON.stringify(scolaritePay.data));
    assert.equal(Number(scolaritePay.data.overpaymentAmount || 0), 0, "Scolarité doit allouer une Mensualité");
    const feesAfterScolarite = await request("/finance/student-fees", { token: adminToken });
    assert.equal(feesAfterScolarite.status, 200);
    const feeRows = Array.isArray(feesAfterScolarite.data)
      ? feesAfterScolarite.data
      : feesAfterScolarite.data?.items ?? [];
    const rateFees = feeRows.filter(
      (row) =>
        (row.studentId === rateStudentCode || row.studentId === rateStudent.data.student?.id) &&
        String(row.status) !== "Annulé",
    );
    const expectedAmount = rateFees.reduce(
      (sum, row) => sum + Math.max(0, Number(row.amountDue || 0) - Number(row.exemption || 0)),
      0,
    );
    const collectedAmount = rateFees.reduce((sum, row) => sum + Math.max(0, Number(row.amountPaid || 0)), 0);
    assert.equal(expectedAmount, 500, JSON.stringify(rateFees));
    assert.equal(collectedAmount, 100, "GET /finance/student-fees.amountPaid alimenté depuis l'allocation");
    assert.equal(Math.round((collectedAmount / expectedAmount) * 100), 20);

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
