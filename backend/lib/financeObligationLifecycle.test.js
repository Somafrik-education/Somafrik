"use strict";

/**
 * F3 — naissance des obligations (mémoire).
 *   node --test backend/lib/financeObligationLifecycle.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createFinanceMemoryStore } = require("../db/financeMemoryStore");
const { studentMatchesClassScope, FINANCE_ERROR } = require("./financeManagement");
const {
  OBLIGATION_LIFECYCLE_REASON,
  NO_APPLICABLE_GRID,
  FINANCE_OBLIGATION_SYNC_FAILED,
  pickEnrollment,
  persistObligationSyncFailure,
  isUnswallowableFinanceSyncError,
} = require("./financeObligationLifecycle");

const STUDENT_ID = "CD-2026-0001-STU-0001";

function createStore(extraStudents = []) {
  const schools = [
    { id: "school-a", code: "CD-2026-0001", currency: "CDF" },
    { id: "school-b", code: "BI-2026-0001", currency: "CDF" },
  ];
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
      academicYear: "2026-2027",
    },
    {
      id: "stu-other",
      publicId: "BI-2026-0001-STU-0001",
      studentCode: "BI-2026-0001-STU-0001",
      firstName: "Jean",
      lastName: "Nkurunziza",
      schoolCode: "BI-2026-0001",
      classId: "class-bi-6a",
      classCode: "CLS-BI-6A",
      className: "6ème A",
      academicYear: "2026-2027",
    },
    ...extraStudents,
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
    listStudentsInClass: async (schoolCode, classRef) =>
      students.filter(
        (student) => student.schoolCode === schoolCode && studentMatchesClassScope(student, classRef),
      ),
    getClassById: async (classId) => {
      if (classId === "class-6a") {
        return { classId: "class-6a", schoolId: "school-a", classCode: "CLS-6A", className: "6ème A", schoolCode: "CD-2026-0001" };
      }
      if (classId === "class-6b") {
        return { classId: "class-6b", schoolId: "school-a", classCode: "CLS-6B", className: "6ème B", schoolCode: "CD-2026-0001" };
      }
      return null;
    },
  });
}

const admin = {
  role: "Admin School",
  schoolCode: "CD-2026-0001",
  firstName: "Admin",
  lastName: "School",
  sub: "USR-F3",
  permissions: ["Paiements:UPDATE"],
};

async function seedGrid(store, items, { className = "6ème A", classId = "class-6a", academicYear = "2026-2027" } = {}) {
  const grid = await store.upsertFinanceFeeGrid(
    {
      classId,
      className,
      academicYear,
      currency: "CDF",
      status: "Active",
      items,
    },
    admin,
  );
  await store.setFinanceFeeGridStatus(grid.id, "Active", admin);
  return grid;
}

function activeFees(store) {
  return store.tables.studentFees.filter((row) => !row.archived_at);
}

describe("F3 scénario A — inscription simple", () => {
  it("activation/apply crée 2 obligations, retry identique", async () => {
    const store = createStore();
    const grid = await seedGrid(store, [
      { feeType: "Scolarité", label: "Scolarité", amount: 30_000, monthlyMonths: ["Septembre"], dueDate: "2026-09-05", status: "Actif" },
      { feeType: "Examen", label: "Examen", amount: 10_000, dueDate: "2026-12-01", status: "Actif" },
    ]);
    const first = await store.applyFinanceFeeGrid(grid.id, admin);
    assert.equal(first.created, 2);
    const retry = await store.applyFinanceFeeGrid(grid.id, admin);
    assert.equal(retry.created, 0);
    assert.equal(activeFees(store).length, 2);
    assert.equal(activeFees(store).every((row) => row.currency === "CDF"), true);
    assert.ok(activeFees(store).some((row) => row.fee_type_code === "TUITION"));
    assert.ok(activeFees(store).some((row) => row.fee_type_code === "EXAM"));
  });
});

describe("F3 scénario B — mensualités", () => {
  it("SEP/OCT/NOV → 3 obligations TUITION, periodKeys uniques, pas Mensualité", async () => {
    const store = createStore();
    const grid = await seedGrid(store, [
      {
        feeType: "Mensualité",
        label: "Scolarité",
        amount: 30_000,
        monthlyMonths: ["Septembre", "Octobre", "Novembre"],
        status: "Actif",
      },
    ]);
    await store.applyFinanceFeeGrid(grid.id, admin);
    const fees = activeFees(store);
    assert.equal(fees.length, 3);
    assert.deepEqual(fees.map((row) => row.period_key).sort(), ["2026-09", "2026-10", "2026-11"]);
    assert.equal(fees.every((row) => row.fee_type === "Scolarité"), true);
    assert.equal(fees.every((row) => row.fee_type_code === "TUITION"), true);
    assert.equal(fees.some((row) => row.fee_type === "Mensualité"), false);
  });
});

describe("F3 scénario C — aucune grille", () => {
  it("enrollment sans grille → 0 dette, état explicite", async () => {
    const store = createStore();
    const result = await store.ensureEnrollmentObligations(
      {
        reason: OBLIGATION_LIFECYCLE_REASON.ENROLLMENT_ACTIVE,
        schoolCode: "CD-2026-0001",
        studentKey: STUDENT_ID,
        academicYear: "2026-2027",
        classId: "class-6a",
      },
      admin,
    );
    assert.equal(result.created, 0);
    assert.equal(result.reason, NO_APPLICABLE_GRID);
    assert.equal(activeFees(store).length, 0);
    assert.ok(store.tables.auditLogs.some((row) => row.action === "no_applicable_finance_grid"));
  });
});

describe("F3 scénario D — tarif modifié", () => {
  it("obligation SEP 30000 reste 30000 après grille à 35000", async () => {
    const store = createStore();
    const grid = await seedGrid(store, [
      { id: "FEE-TUITION-6A", feeType: "Scolarité", label: "Scolarité", amount: 30_000, monthlyMonths: ["Septembre"], status: "Actif" },
    ]);
    await store.applyFinanceFeeGrid(grid.id, admin);
    await store.upsertFinanceFeeGrid(
      {
        id: grid.id,
        classId: "class-6a",
        className: "6ème A",
        academicYear: "2026-2027",
        currency: "CDF",
        status: "Active",
        items: [
          { id: "FEE-TUITION-6A", feeType: "Scolarité", label: "Scolarité", amount: 35_000, monthlyMonths: ["Septembre"], status: "Actif" },
        ],
      },
      admin,
    );
    await store.applyFinanceFeeGrid(grid.id, admin);
    const fees = activeFees(store);
    assert.equal(fees.length, 1);
    assert.equal(Number(fees[0].amount_due), 30_000);
  });
});

describe("F3 scénario E — reapply", () => {
  it("10 apply → nombre d'obligations inchangé", async () => {
    const store = createStore();
    const grid = await seedGrid(store, [
      { feeType: "Inscription", label: "Inscription", amount: 20_000, status: "Actif" },
    ]);
    await store.applyFinanceFeeGrid(grid.id, admin);
    for (let i = 0; i < 9; i += 1) {
      await store.applyFinanceFeeGrid(grid.id, admin);
    }
    assert.equal(activeFees(store).length, 1);
  });
});

describe("F3 scénario G — changement de classe", () => {
  it("payé/partiel immuables, futur non payé supersede, futur 6B créé", async () => {
    const store = createStore();
    const gridA = await seedGrid(store, [
      {
        feeType: "Scolarité",
        label: "Scolarité 6A",
        amount: 30_000,
        monthlyMonths: ["Décembre", "Janvier", "Février"],
        status: "Actif",
      },
    ]);
    await store.applyFinanceFeeGrid(gridA.id, admin);
    const dec = store.tables.studentFees.find((row) => row.period_key === "2026-12");
    const jan = store.tables.studentFees.find((row) => row.period_key === "2027-01");
    dec.amount_paid = 30_000;
    dec.balance = 0;
    dec.status = "Payé";
    jan.amount_paid = 10_000;
    jan.balance = 20_000;
    jan.status = "Partiellement payé";

    const gridB = await seedGrid(
      store,
      [
        {
          feeType: "Scolarité",
          label: "Scolarité 6B",
          amount: 32_000,
          monthlyMonths: ["Décembre", "Janvier", "Février"],
          status: "Actif",
        },
      ],
      { className: "6ème B", classId: "class-6b" },
    );

    const student = {
      id: "stu-1",
      dbId: "stu-1",
      publicId: STUDENT_ID,
      studentCode: STUDENT_ID,
      firstName: "Awa",
      lastName: "Diop",
      schoolCode: "CD-2026-0001",
      classId: "class-6b",
      classCode: "CLS-6B",
      className: "6ème B",
      academicYear: "2026-2027",
      enrollments: [
        {
          id: "enr-1",
          classId: "class-6b",
          classCode: "CLS-6B",
          className: "6ème B",
          academicYear: "2026-2027",
          status: "active",
        },
      ],
    };
    const school = { id: "school-a", code: "CD-2026-0001", currency: "CDF" };
    const result = await store.ensureEnrollmentObligations(
      {
        reason: OBLIGATION_LIFECYCLE_REASON.CLASS_TRANSFER,
        school,
        student,
        academicYear: "2026-2027",
        classId: "class-6b",
        previousClass: { classId: "class-6a", className: "6ème A" },
        effectiveDate: "2027-01-15",
        grid: { ...gridB, schoolId: "school-a", status: "Active" },
      },
      admin,
    );
    assert.ok(result.superseded >= 1);
    const decAfter = store.tables.studentFees.find((row) => row.id === dec.id);
    const janAfter = store.tables.studentFees.find((row) => row.id === jan.id);
    assert.equal(decAfter.status, "Payé");
    assert.equal(Number(decAfter.amount_due), 30_000);
    assert.equal(!decAfter.archived_at, true);
    assert.equal(janAfter.status, "Partiellement payé");
    assert.equal(!janAfter.archived_at, true);
    const febOld = store.tables.studentFees.find((row) => row.period_key === "2027-02" && row.class_id === "class-6a");
    assert.ok(febOld.archived_at);
    assert.equal(febOld.cancel_reason, "CLASS_TRANSFER");
    const febNew = store.tables.studentFees.find((row) => row.period_key === "2027-02" && !row.archived_at);
    assert.ok(febNew);
    assert.equal(String(febNew.class_id), "class-6b");
  });
});

describe("F3 scénario H — nouvelle année", () => {
  it("2026-2027 et 2027-2028 restent deux ensembles distincts", async () => {
    const store = createStore();
    const y1 = await seedGrid(store, [{ feeType: "Inscription", label: "Inscription", amount: 20_000, status: "Actif" }], {
      academicYear: "2026-2027",
    });
    const y2 = await seedGrid(store, [{ feeType: "Inscription", label: "Inscription", amount: 22_000, status: "Actif" }], {
      academicYear: "2027-2028",
    });
    await store.applyFinanceFeeGrid(y1.id, admin);
    const studentY2 = {
      id: "stu-1",
      dbId: "stu-1",
      publicId: STUDENT_ID,
      studentCode: STUDENT_ID,
      firstName: "Awa",
      lastName: "Diop",
      schoolCode: "CD-2026-0001",
      classId: "class-6a",
      classCode: "CLS-6A",
      className: "6ème A",
      academicYear: "2027-2028",
      enrollments: [
        {
          classId: "class-6a",
          className: "6ème A",
          academicYear: "2027-2028",
          status: "active",
        },
      ],
    };
    await store.ensureEnrollmentObligations(
      {
        reason: OBLIGATION_LIFECYCLE_REASON.ENROLLMENT_ACTIVE,
        school: { id: "school-a", code: "CD-2026-0001", currency: "CDF" },
        student: studentY2,
        academicYear: "2027-2028",
        classId: "class-6a",
        grid: { ...y2, schoolId: "school-a", status: "Active" },
      },
      admin,
    );
    const years = activeFees(store).map((row) => row.academic_year).sort();
    assert.deepEqual(years, ["2026-2027", "2027-2028"]);
    assert.equal(activeFees(store).length, 2);
  });
});

describe("F3 scénario I — cross tenant", () => {
  it("élève A + grille B → refus, 0 obligation", async () => {
    const store = createStore();
    const gridB = await store.upsertFinanceFeeGrid(
      {
        className: "6ème A",
        academicYear: "2026-2027",
        currency: "CDF",
        status: "Active",
        items: [{ feeType: "Inscription", label: "Inscription", amount: 10_000, status: "Actif" }],
      },
      { ...admin, schoolCode: "BI-2026-0001" },
    );
    await store.setFinanceFeeGridStatus(gridB.id, "Active", { ...admin, schoolCode: "BI-2026-0001" });
    const before = activeFees(store).length;
    await assert.rejects(
      () =>
        store.ensureEnrollmentObligations(
          {
            reason: OBLIGATION_LIFECYCLE_REASON.GRID_APPLY,
            school: { id: "school-a", code: "CD-2026-0001", currency: "CDF" },
            studentKey: STUDENT_ID,
            academicYear: "2026-2027",
            classId: "class-6a",
            grid: { ...gridB, schoolId: "school-b", schoolCode: "BI-2026-0001", status: "Active" },
          },
          admin,
        ),
      (error) => error.code === "TENANT_MISMATCH" || error.code === "FINANCE_ALLOCATION_TENANT_MISMATCH",
    );
    assert.equal(activeFees(store).length, before);
  });
});

describe("F3 P1-A — enrollment scope fail-closed", () => {
  it("pickEnrollment refuse de retomber sur une autre inscription", () => {
    const rows = [
      { classId: "class-6a", academicYear: "2026-2027" },
    ];
    assert.throws(
      () => pickEnrollment(rows, { academicYear: "2027-2028" }),
      (error) => error.code === FINANCE_ERROR.ENROLLMENT_NOT_FOUND,
    );
    assert.throws(
      () => pickEnrollment(rows, { classId: "class-6b" }),
      (error) => error.code === FINANCE_ERROR.CLASS_ENROLLMENT_MISMATCH,
    );
    assert.equal(pickEnrollment(rows, { classId: "class-6a", academicYear: "2026-2027" }).classId, "class-6a");
  });

  it("6A enrollment + grid 6B => 0 obligation / erreur", async () => {
    const store = createStore();
    await seedGrid(store, [{ feeType: "Scolarité", label: "Scolarité", amount: 30_000, monthlyMonths: ["Septembre"], status: "Actif" }]);
    const gridB = await seedGrid(
      store,
      [{ feeType: "Scolarité", label: "Scolarité 6B", amount: 32_000, monthlyMonths: ["Septembre"], status: "Actif" }],
      { className: "6ème B", classId: "class-6b" },
    );
    const before = activeFees(store).length;
    await assert.rejects(
      () =>
        store.ensureEnrollmentObligations(
          {
            reason: OBLIGATION_LIFECYCLE_REASON.GRID_APPLY,
            school: { id: "school-a", code: "CD-2026-0001", currency: "CDF" },
            studentKey: STUDENT_ID,
            academicYear: "2026-2027",
            classId: "class-6a",
            grid: { ...gridB, schoolId: "school-a", status: "Active" },
          },
          admin,
        ),
      (error) => error.code === FINANCE_ERROR.GRID_ENROLLMENT_MISMATCH,
    );
    assert.equal(activeFees(store).length, before);
  });

  it("2026-2027 enrollment + grid 2027-2028 => 0 obligation / erreur", async () => {
    const store = createStore();
    const gridNext = await seedGrid(
      store,
      [{ feeType: "Inscription", label: "Inscription", amount: 20_000, status: "Actif" }],
      { academicYear: "2027-2028" },
    );
    await assert.rejects(
      () =>
        store.ensureEnrollmentObligations(
          {
            reason: OBLIGATION_LIFECYCLE_REASON.GRID_APPLY,
            school: { id: "school-a", code: "CD-2026-0001", currency: "CDF" },
            studentKey: STUDENT_ID,
            grid: { ...gridNext, schoolId: "school-a", status: "Active" },
          },
          admin,
        ),
      (error) =>
        error.code === FINANCE_ERROR.ENROLLMENT_NOT_FOUND || error.code === FINANCE_ERROR.GRID_ENROLLMENT_MISMATCH,
    );
    assert.equal(activeFees(store).length, 0);
  });

  it("classId inconnu => 0 obligation", async () => {
    const store = createStore();
    await assert.rejects(
      () =>
        store.ensureEnrollmentObligations(
          {
            reason: OBLIGATION_LIFECYCLE_REASON.ENROLLMENT_ACTIVE,
            schoolCode: "CD-2026-0001",
            studentKey: STUDENT_ID,
            academicYear: "2026-2027",
            classId: "class-unknown",
          },
          admin,
        ),
      (error) => error.code === FINANCE_ERROR.CLASS_ENROLLMENT_MISMATCH,
    );
    assert.equal(activeFees(store).length, 0);
  });

  it("année inconnue => 0 obligation", async () => {
    const store = createStore();
    await assert.rejects(
      () =>
        store.ensureEnrollmentObligations(
          {
            reason: OBLIGATION_LIFECYCLE_REASON.ENROLLMENT_ACTIVE,
            schoolCode: "CD-2026-0001",
            studentKey: STUDENT_ID,
            academicYear: "2099-2100",
            classId: "class-6a",
          },
          admin,
        ),
      (error) => error.code === FINANCE_ERROR.ENROLLMENT_NOT_FOUND,
    );
    assert.equal(activeFees(store).length, 0);
  });
});

describe("F3 P1-B — date effective de transfert", () => {
  it("transfert sans effectiveDate n'annule aucune obligation", async () => {
    const store = createStore();
    const gridA = await seedGrid(store, [
      {
        feeType: "Scolarité",
        label: "Scolarité 6A",
        amount: 30_000,
        monthlyMonths: ["Décembre", "Janvier", "Février"],
        status: "Actif",
      },
    ]);
    await store.applyFinanceFeeGrid(gridA.id, admin);
    const before = store.tables.studentFees.map((row) => ({
      id: row.id,
      archived: row.archived_at || null,
      cancel: row.cancel_reason || null,
    }));
    const student = {
      id: "stu-1",
      dbId: "stu-1",
      publicId: STUDENT_ID,
      studentCode: STUDENT_ID,
      firstName: "Awa",
      lastName: "Diop",
      schoolCode: "CD-2026-0001",
      classId: "class-6b",
      classCode: "CLS-6B",
      className: "6ème B",
      academicYear: "2026-2027",
      enrollments: [
        {
          id: "enr-1",
          classId: "class-6b",
          className: "6ème B",
          academicYear: "2026-2027",
          status: "active",
        },
      ],
    };
    await assert.rejects(
      () =>
        store.ensureEnrollmentObligations(
          {
            reason: OBLIGATION_LIFECYCLE_REASON.CLASS_TRANSFER,
            school: { id: "school-a", code: "CD-2026-0001", currency: "CDF" },
            student,
            academicYear: "2026-2027",
            classId: "class-6b",
            previousClass: { classId: "class-6a", className: "6ème A" },
          },
          admin,
        ),
      (error) => error.code === FINANCE_ERROR.NEEDS_EFFECTIVE_DATE,
    );
    const after = store.tables.studentFees;
    assert.equal(after.length, before.length);
    assert.equal(after.every((row) => !row.archived_at && !row.cancel_reason), true);
  });
});

describe("F3 P1 intégration — erreurs non avalables", () => {
  it("NEEDS_EFFECTIVE_DATE et mismatches déterministes ne sont pas avalés", () => {
    assert.equal(isUnswallowableFinanceSyncError({ code: FINANCE_ERROR.NEEDS_EFFECTIVE_DATE }), true);
    assert.equal(isUnswallowableFinanceSyncError({ code: FINANCE_ERROR.ENROLLMENT_NOT_FOUND }), true);
    assert.equal(isUnswallowableFinanceSyncError({ code: FINANCE_ERROR.CLASS_ENROLLMENT_MISMATCH }), true);
    assert.equal(isUnswallowableFinanceSyncError({ code: FINANCE_ERROR.GRID_ENROLLMENT_MISMATCH }), true);
    assert.equal(isUnswallowableFinanceSyncError({ code: FINANCE_ERROR.TENANT_MISMATCH }), true);
    assert.equal(isUnswallowableFinanceSyncError({ code: "FORCED_ENGINE_FAILURE" }), false);
    assert.equal(isUnswallowableFinanceSyncError({ code: FINANCE_OBLIGATION_SYNC_FAILED }), false);
  });
});

describe("F3 P1 recovery — contexte de transfert durable", () => {
  it("persistObligationSyncFailure conserve previousClass, targetClass et effectiveDate", async () => {
    const store = createStore();
    const error = new Error("forced engine failure");
    error.code = "FORCED_ENGINE_FAILURE";
    await persistObligationSyncFailure(
      store,
      {
        reason: OBLIGATION_LIFECYCLE_REASON.CLASS_TRANSFER,
        studentKey: STUDENT_ID,
        classId: "class-6b",
        academicYear: "2026-2027",
        effectiveDate: "2026-09-15",
        previousClass: { classId: "class-6a", classCode: "CLS-6A", className: "6ème A" },
        student: { classCode: "CLS-6B", className: "6ème B", studentCode: STUDENT_ID },
      },
      admin,
      null,
      error,
    );
    const audit = store.tables.auditLogs.find((row) => row.action === "finance_obligation_sync_failed");
    assert.ok(audit);
    assert.equal(audit.newValue.previousClassId, "class-6a");
    assert.equal(audit.newValue.targetClassId, "class-6b");
    assert.equal(audit.newValue.effectiveDate, "2026-09-15");
    assert.equal(audit.newValue.academicYear, "2026-2027");
    assert.equal(audit.newValue.retryStatus, "pending");
    assert.equal(audit.newValue.lifecycleReason, OBLIGATION_LIFECYCLE_REASON.CLASS_TRANSFER);
    assert.equal(audit.newValue.errorCode, "FORCED_ENGINE_FAILURE");
  });
});

describe("F3 P1-C — échec Finance durable", () => {
  it("erreur moteur forcée après enrollment => 0 fausse dette + audit rattrapable", async () => {
    const store = createStore();
    const grid = await seedGrid(store, [
      { feeType: "Inscription", label: "Inscription", amount: 20_000, status: "Actif" },
    ]);
    const original = store.withTransaction.bind(store);
    let firstTx = true;
    store.withTransaction = (fn) =>
      original(async (tx) => {
        if (firstTx) {
          firstTx = false;
          tx.insertObligationIfAbsent = async () => {
            const error = new Error("forced engine failure");
            error.code = "FORCED_ENGINE_FAILURE";
            throw error;
          };
        }
        return fn(tx);
      });
    await assert.rejects(
      () =>
        store.ensureEnrollmentObligations(
          {
            reason: OBLIGATION_LIFECYCLE_REASON.ENROLLMENT_ACTIVE,
            schoolCode: "CD-2026-0001",
            studentKey: STUDENT_ID,
            academicYear: "2026-2027",
            classId: "class-6a",
            grid: { ...grid, schoolId: "school-a", status: "Active" },
          },
          admin,
        ),
      (error) => error.code === "FORCED_ENGINE_FAILURE",
    );
    store.withTransaction = original;
    assert.equal(activeFees(store).length, 0);
    assert.ok(
      store.tables.auditLogs.some(
        (row) =>
          row.action === "finance_obligation_sync_failed" &&
          row.newValue?.reason === FINANCE_OBLIGATION_SYNC_FAILED,
      ),
    );
  });
});

describe("F3 scénario J — paiement ne crée pas de dette", () => {
  it("encaissement Non imputé sans obligation → 0 obligation créée", async () => {
    const store = createStore();
    const before = store.tables.studentFees.length;
    const payment = await store.createSchoolPayment(
      {
        studentId: STUDENT_ID,
        items: [{ feeType: "Non imputé", amount: 5_000 }],
        method: "Espèces",
        date: "2026-09-01",
      },
      admin,
    );
    assert.equal(store.tables.studentFees.length, before);
    assert.equal(store.tables.payments.length, 1);
    assert.equal(store.tables.allocations.length, 0);
    assert.equal(payment.unallocatedAmount, 5_000);
    assert.equal(payment.status, "Non imputé");
  });
});
