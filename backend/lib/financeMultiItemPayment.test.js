"use strict";

/**
 * Reçu unique multi-libellés — mémoire : Esther 500+1+40, rollback, totaux serveur.
 */
const assert = require("node:assert/strict");
const { createFinanceMemoryStore } = require("../db/financeMemoryStore");
const { FINANCE_ERROR } = require("./financeManagement");

function createStore() {
  const schools = [
    { id: "school-a", code: "CD-2026-0001", currency: "CDF" },
    { id: "school-b", code: "BI-2026-0001", currency: "CDF" },
  ];
  const students = [
    {
      id: "stu-esther",
      publicId: "CD-2026-0001-STU-ESTHER",
      studentCode: "CD-2026-0001-STU-ESTHER",
      firstName: "Esther",
      lastName: "Okito",
      schoolCode: "CD-2026-0001",
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
          if (scope && scope !== "*" && String(student.schoolCode).toUpperCase() !== scope) return false;
          return [student.id, student.publicId, student.studentCode].includes(studentKey);
        }) ?? null
      );
    },
    listStudentsInClass: async () => students,
  });
}

const admin = {
  role: "Admin School",
  schoolCode: "CD-2026-0001",
  firstName: "Admin",
  lastName: "School",
  sub: "USR-MEM-ADMIN",
};

const ESTHER_ITEMS = [
  { feeType: "Minerval / scolarité", amount: 500 },
  { feeType: "Frais d'examen", amount: 1 },
  { feeType: "Frais de cantine", amount: 40 },
];

async function main() {
  const store = createStore();
  const created = await store.createSchoolPayment(
    {
      studentId: "CD-2026-0001-STU-ESTHER",
      items: ESTHER_ITEMS,
      paymentMethod: "cash",
      paidAt: "2026-08-19",
      totalAmount: 1,
    },
    admin,
  );

  assert.equal(store.tables.payments.length, 1, "payments +1 seulement");
  assert.equal(store.tables.paymentItems.length, 3, "payment_items +3");
  assert.equal(created.totalAmount, 541);
  assert.equal(created.amount, 541);
  assert.equal(created.items.length, 3);
  assert.match(created.reference, /PAY-0001$/);
  const uniqueRefs = new Set(store.tables.payments.map((row) => row.payment_code));
  assert.equal(uniqueRefs.size, 1, "une seule référence");
  const estherRows = store.tables.payments.filter((row) => String(row.student_code).includes("ESTHER"));
  assert.equal(estherRows.length, 1, "Esther existe une fois comme reçu");

  await assert.rejects(
    () =>
      store.createSchoolPayment(
        { studentId: "CD-2026-0001-STU-ESTHER", items: [], paymentMethod: "Espèces", paidAt: "2026-08-19" },
        admin,
      ),
    (error) => error.code === FINANCE_ERROR.PAYMENT_ITEMS_REQUIRED,
  );
  await assert.rejects(
    () =>
      store.createSchoolPayment(
        {
          studentId: "CD-2026-0001-STU-ESTHER",
          items: [{ feeType: "Minerval / scolarité", amount: 0 }],
          paymentMethod: "Espèces",
          paidAt: "2026-08-19",
        },
        admin,
      ),
    (error) => error.code === FINANCE_ERROR.PAYMENT_ITEM_AMOUNT_INVALID,
  );

  const beforeFail = store.tables.payments.length;
  const original = store.withTransaction.bind(store);
  store.withTransaction = (fn) =>
    original(async (tx) => {
      const insert = tx.insertPaymentItem.bind(tx);
      let calls = 0;
      tx.insertPaymentItem = async (item) => {
        calls += 1;
        if (calls === 3) throw new Error("échec item #3");
        return insert(item);
      };
      return fn(tx);
    });
  await assert.rejects(
    () =>
      store.createSchoolPayment(
        {
          studentId: "CD-2026-0001-STU-ESTHER",
          items: ESTHER_ITEMS,
          paymentMethod: "Espèces",
          paidAt: "2026-08-20",
        },
        admin,
      ),
    (error) => String(error.message).includes("échec item #3"),
  );
  assert.equal(store.tables.payments.length, beforeFail, "aucun payment créé si item #3 échoue");
  assert.equal(store.tables.paymentItems.length, 3);
  store.withTransaction = original;

  const cancelled = await store.cancelSchoolPayment(created.reference, "Annulation reçu complet", admin);
  assert.equal(cancelled.status, "Annulé");
  assert.equal(cancelled.itemCount, 3);
  assert.equal(store.tables.payments.length, 1);

  const local = createStore();
  local.tables.schoolFeeItems.push({
    id: "fee-item-other-tenant",
    school_id: "school-b",
    school_code: "BI-2026-0001",
    fee_grid_id: "grid-b",
    grid_code: "GRID-B",
    item_code: "FEE-B-1",
    fee_type: "Inscription",
    label: "Inscription B",
    amount: 10,
    status: "Actif",
    profile_payload: {},
  });
  await assert.rejects(
    () =>
      local.createSchoolPayment(
        {
          studentId: "CD-2026-0001-STU-ESTHER",
          items: [{ feeTypeId: "fee-item-other-tenant", amount: 10 }],
          paymentMethod: "Espèces",
          paidAt: "2026-08-19",
        },
        admin,
      ),
    (error) => error.code === FINANCE_ERROR.FEE_ITEM_TENANT_MISMATCH,
  );

  console.log("financeMultiItemPayment.test.js: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
