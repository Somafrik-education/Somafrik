"use strict";

/**
 * P1 — createPayment refuse les types legacy ambigus (Annexe / Bulletin)
 * sur les chemins feeTypeId et obligationId. POST /api/payments appelle
 * createSchoolPayment → createPayment ; ces tests couvrent ce service.
 *
 * F4 : une imputation exige obligationId explicite. Les cas alias non ambigus
 * conservent ici la preuve F2 de canonicalisation, mais ne sélectionnent plus
 * une dette par feeType seul.
 *
 *   node --test backend/lib/financeFeeTypeWriteBypass.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createFinanceMemoryStore } = require("../db/financeMemoryStore");
const { FEE_TYPE_ERROR, resolveFeeType } = require("./financeFeeTypes");
const { obligationMatchesPaymentFeeType } = require("./financeFeeTypeMatch");
const { studentMatchesClassScope } = require("./financeManagement");

const STUDENT_ID = "CD-2026-0001-STU-0001";

function createStore() {
  const schools = [{ id: "school-a", code: "CD-2026-0001", currency: "CDF" }];
  const students = [
    {
      id: "stu-1",
      publicId: STUDENT_ID,
      studentCode: STUDENT_ID,
      firstName: "Awa",
      lastName: "Diop",
      schoolCode: "CD-2026-0001",
      classId: "class-6a",
      classCode: "CLS-6A",
      className: "6ème A",
    },
  ];
  return createFinanceMemoryStore({
    getSchoolByCode: async (code) =>
      schools.find((row) => row.code === String(code).trim().toUpperCase()) ?? null,
    findStudent: async (studentKey, principal) => {
      const scope = String(principal?.schoolCode ?? "").toUpperCase();
      return (
        students.find((student) => {
          if (scope && scope !== "*" && String(student.schoolCode).toUpperCase() !== scope) {
            return false;
          }
          return [student.id, student.publicId, student.studentCode].includes(studentKey);
        }) ?? null
      );
    },
    listStudentsInClass: async (schoolCode, classRef) =>
      students.filter(
        (student) => student.schoolCode === schoolCode && studentMatchesClassScope(student, classRef),
      ),
  });
}

const admin = {
  role: "Admin School",
  schoolCode: "CD-2026-0001",
  firstName: "Admin",
  lastName: "School",
  sub: "USR-F2-WRITE",
  permissions: ["Paiements:UPDATE"],
};

function seedLegacyCatalogItem(store, { id, itemCode, feeType, label, amount = 100 }) {
  store.tables.schoolFeeItems.push({
    id,
    school_id: "school-a",
    school_code: "CD-2026-0001",
    fee_grid_id: "legacy-grid",
    grid_code: "LEGACY-GRID",
    item_code: itemCode,
    fee_type: feeType,
    label: label || feeType,
    amount,
    due_date: "2026-01-01",
    period_label: "",
    monthly_months: [],
    mandatory: true,
    status: "Actif",
    profile_payload: {},
  });
}

function seedLegacyObligation(store, { id, publicId, feeType, label, amount = 100, schoolFeeItemId = null }) {
  store.tables.studentFees.push({
    id,
    school_id: "school-a",
    school_code: "CD-2026-0001",
    student_id: "stu-1",
    student_code: STUDENT_ID,
    school_fee_item_id: schoolFeeItemId,
    fee_type: feeType,
    label: label || feeType,
    currency: "CDF",
    academic_year: "2025-2026",
    period_label: "",
    initial_amount: amount,
    discount: 0,
    exemption: 0,
    amount_due: amount,
    amount_paid: 0,
    balance: amount,
    status: "À payer",
    due_date: "2026-01-01",
    profile_payload: {
      publicId,
      studentId: STUDENT_ID,
      schoolCode: "CD-2026-0001",
    },
  });
}

function pay(store, items) {
  return store.createSchoolPayment(
    {
      studentId: STUDENT_ID,
      items,
      method: "Espèces",
      date: "2026-08-27",
    },
    admin,
  );
}

function assertNoPaymentWrites(store) {
  assert.equal(store.tables.payments.length, 0, "aucun payment");
  assert.equal(store.tables.paymentItems.length, 0, "aucun payment_item");
  assert.equal(store.tables.allocations.length, 0, "aucune allocation");
}

function persistedFeeTypes(store) {
  return store.tables.paymentItems.map((row) => row.fee_type);
}

describe("P1 createPayment feeTypeId / schoolFeeItemId fail-closed", () => {
  it("1. feeTypeId legacy Annexe → FINANCE_FEE_TYPE_AMBIGUOUS, aucune écriture", async () => {
    const store = createStore();
    const catalogId = randomUUID();
    seedLegacyCatalogItem(store, {
      id: catalogId,
      itemCode: "FEE-ANNEXE",
      feeType: "Annexe",
      label: "Annexe",
    });

    await assert.rejects(
      () => pay(store, [{ feeTypeId: catalogId, amount: 100 }]),
      (error) => error.code === FEE_TYPE_ERROR.AMBIGUOUS && error.statusCode === 400,
    );
    assertNoPaymentWrites(store);
  });

  it("1b. schoolFeeItemId legacy Annexe → même refus", async () => {
    const store = createStore();
    const catalogId = randomUUID();
    seedLegacyCatalogItem(store, {
      id: catalogId,
      itemCode: "FEE-ANNEXE-ALIAS",
      feeType: "Annexe",
      label: "Annexe cantine",
    });

    await assert.rejects(
      () => pay(store, [{ schoolFeeItemId: "FEE-ANNEXE-ALIAS", amount: 40 }]),
      (error) => error.code === FEE_TYPE_ERROR.AMBIGUOUS,
    );
    assertNoPaymentWrites(store);
  });
});

describe("P1 createPayment obligationId inféré fail-closed", () => {
  it("2. obligationId legacy Annexe + feeType vide → FINANCE_FEE_TYPE_AMBIGUOUS, aucune écriture", async () => {
    const store = createStore();
    const obligationId = randomUUID();
    seedLegacyObligation(store, {
      id: obligationId,
      publicId: "STUFEE-ANNEXE",
      feeType: "Annexe",
      label: "Annexe",
    });

    await assert.rejects(
      () => pay(store, [{ obligationId: "STUFEE-ANNEXE", feeType: "", amount: 100 }]),
      (error) => error.code === FEE_TYPE_ERROR.AMBIGUOUS && error.statusCode === 400,
    );
    assertNoPaymentWrites(store);
    const obligation = store.tables.studentFees.find((row) => row.id === obligationId);
    assert.equal(Number(obligation.amount_paid), 0, "obligation historique non mutée");
    assert.equal(obligation.fee_type, "Annexe");
  });
});

describe("P1 createPayment Bulletin fail-closed", () => {
  it("3. feeTypeId Frais de bulletin → FINANCE_FEE_TYPE_AMBIGUOUS, aucune écriture", async () => {
    const store = createStore();
    const catalogId = randomUUID();
    seedLegacyCatalogItem(store, {
      id: catalogId,
      itemCode: "FEE-BULLETIN",
      feeType: "Frais de bulletin",
      label: "Frais de bulletin",
    });

    await assert.rejects(
      () => pay(store, [{ feeTypeId: catalogId, amount: 25 }]),
      (error) => error.code === FEE_TYPE_ERROR.AMBIGUOUS,
    );
    assertNoPaymentWrites(store);
  });

  it("3b. obligationId Frais de bulletin + feeType vide → même refus", async () => {
    const store = createStore();
    seedLegacyObligation(store, {
      id: randomUUID(),
      publicId: "STUFEE-BULLETIN",
      feeType: "Frais de bulletin",
      label: "Bulletin trimestre 1",
    });

    await assert.rejects(
      () => pay(store, [{ obligationId: "STUFEE-BULLETIN", amount: 25 }]),
      (error) => error.code === FEE_TYPE_ERROR.AMBIGUOUS,
    );
    assertNoPaymentWrites(store);
  });
});

describe("P1 createPayment alias non ambigus → Scolarité", () => {
  it("4. Mensualité legacy feeTypeId + obligationId → accepté, persisté Scolarité", async () => {
    const store = createStore();
    const catalogId = randomUUID();
    seedLegacyCatalogItem(store, {
      id: catalogId,
      itemCode: "FEE-MENSUALITE",
      feeType: "Mensualité",
      label: "Mensualité — Janvier",
      amount: 150,
    });
    seedLegacyObligation(store, {
      id: randomUUID(),
      publicId: "STUFEE-MENSUALITE",
      feeType: "Mensualité",
      label: "Mensualité — Janvier",
      amount: 150,
      schoolFeeItemId: catalogId,
    });

    const payment = await pay(store, [
      { feeTypeId: catalogId, obligationId: "STUFEE-MENSUALITE", amount: 150 },
    ]);
    assert.equal(payment.items[0].feeType, "Scolarité");
    assert.deepEqual(persistedFeeTypes(store), ["Scolarité"]);
    assert.equal(store.tables.payments.length, 1);
    assert.equal(store.tables.allocations.length, 1);
  });

  it("4b. obligationId Mensualité + feeType vide → persisté Scolarité", async () => {
    const store = createStore();
    seedLegacyObligation(store, {
      id: randomUUID(),
      publicId: "STUFEE-MENSUALITE-OBL",
      feeType: "Mensualité",
      label: "Mensualité — Février",
      amount: 150,
    });

    const payment = await pay(store, [{ obligationId: "STUFEE-MENSUALITE-OBL", feeType: "", amount: 150 }]);
    assert.equal(payment.items[0].feeType, "Scolarité");
    assert.deepEqual(persistedFeeTypes(store), ["Scolarité"]);
    assert.equal(store.tables.allocations.length, 1);
  });

  it("5. Minerval / scolarité feeTypeId + obligationId → accepté, persisté Scolarité", async () => {
    const store = createStore();
    const catalogId = randomUUID();
    seedLegacyCatalogItem(store, {
      id: catalogId,
      itemCode: "FEE-MINERVAL",
      feeType: "Minerval / scolarité",
      label: "Minerval / scolarité",
      amount: 200,
    });
    seedLegacyObligation(store, {
      id: randomUUID(),
      publicId: "STUFEE-MINERVAL",
      feeType: "Minerval / scolarité",
      label: "Minerval / scolarité",
      amount: 200,
      schoolFeeItemId: catalogId,
    });

    const payment = await pay(store, [
      { feeTypeId: catalogId, obligationId: "STUFEE-MINERVAL", amount: 200 },
    ]);
    assert.equal(payment.items[0].feeType, "Scolarité");
    assert.deepEqual(persistedFeeTypes(store), ["Scolarité"]);
  });

  it("5b. Minerval / scolarité libre + obligationId → persisté Scolarité", async () => {
    const store = createStore();
    seedLegacyObligation(store, {
      id: randomUUID(),
      publicId: "STUFEE-MINERVAL-FREE",
      feeType: "Minerval / scolarité",
      label: "Minerval / scolarité",
      amount: 80,
    });
    const payment = await pay(store, [
      { obligationId: "STUFEE-MINERVAL-FREE", feeType: "Minerval / scolarité", amount: 80 },
    ]);
    assert.equal(payment.items[0].feeType, "Scolarité");
    assert.deepEqual(persistedFeeTypes(store), ["Scolarité"]);
  });
});

describe("P1 lecture historique Annexe / Bulletin", () => {
  it("6. obligations et payment_items historiques restent lisibles, sans réécriture", async () => {
    const store = createStore();
    seedLegacyObligation(store, {
      id: randomUUID(),
      publicId: "STUFEE-ANNEXE-READ",
      feeType: "Annexe",
      label: "Cantine",
      amount: 40,
    });
    seedLegacyObligation(store, {
      id: randomUUID(),
      publicId: "STUFEE-BULLETIN-READ",
      feeType: "Frais de bulletin",
      label: "Frais de bulletin",
      amount: 15,
    });

    const fees = await store.listFinanceStudentFees(admin);
    const annexe = fees.find((row) => row.feeType === "Annexe");
    const bulletin = fees.find((row) => row.feeType === "Frais de bulletin");
    assert.ok(annexe, "obligation Annexe historique lisible");
    assert.equal(annexe.label, "Cantine");
    assert.ok(bulletin, "obligation Bulletin historique lisible");
    assert.equal(resolveFeeType("Annexe", { mode: "read" }), null);
    assert.equal(resolveFeeType("Frais de bulletin", { mode: "read" }), null);
    assert.equal(
      obligationMatchesPaymentFeeType({ feeType: "Annexe", label: "Cantine" }, "Cantine"),
      true,
    );
    assert.equal(
      obligationMatchesPaymentFeeType({ feeType: "Annexe", label: "Cantine" }, "Annexe"),
      true,
    );

    const paymentId = randomUUID();
    store.tables.payments.push({
      id: paymentId,
      school_id: "school-a",
      school_code: "CD-2026-0001",
      student_id: "stu-1",
      student_code: STUDENT_ID,
      payment_code: "CD-2026-0001-2025-PAY-HIST",
      amount: 40,
      currency: "CDF",
      payment_method: "Espèces",
      payment_status: "posted",
      payment_date: "2025-11-02",
      fee_type: "Annexe",
      profile_payload: {
        reference: "CD-2026-0001-2025-PAY-HIST",
        studentId: STUDENT_ID,
        feeType: "Annexe",
        status: "Payé",
      },
      created_at: "2025-11-02T10:00:00.000Z",
      cancelled_at: null,
    });
    store.tables.paymentItems.push({
      id: randomUUID(),
      school_id: "school-a",
      payment_id: paymentId,
      school_fee_item_id: null,
      fee_type: "Annexe",
      fee_label: "Cantine",
      amount: 40,
      sort_order: 0,
      created_at: "2025-11-02T10:00:00.000Z",
    });

    const historical = await store.getSchoolPayment("CD-2026-0001-2025-PAY-HIST", admin);
    assert.equal(historical.items[0].feeType, "Annexe");
    assert.equal(historical.items[0].feeLabel, "Cantine");
  });
});