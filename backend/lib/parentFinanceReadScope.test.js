"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  financeRowMatchesLinkedStudent,
  filterFinanceRowsForLinkedStudent,
} = require("../db/financePgStore");
const { UnpaidService } = require("../services/unpaidService");

const A_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const A_CODE = "ELE-26-0001";
const B_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const B_CODE = "ELE-26-0002";

function parent() {
  return {
    role: "Parent",
    roleKeys: ["PARENT"],
    studentIds: [A_UUID, A_CODE],
    schoolCode: "CD-IN-26-001",
    financeLoginCode: "CD-IN-26-001",
  };
}

test("finance parent: filtre obligations/paiements/options sur enfants liés", () => {
  const principal = parent();
  const rows = [
    { id: "fee-a", studentId: A_CODE, studentDbId: A_UUID },
    { id: "fee-b", studentId: B_CODE, studentDbId: B_UUID },
  ];
  assert.equal(financeRowMatchesLinkedStudent(rows[0], principal), true);
  assert.equal(financeRowMatchesLinkedStudent(rows[1], principal), false);
  assert.deepEqual(
    filterFinanceRowsForLinkedStudent(rows, principal).map((row) => row.id),
    ["fee-a"],
  );
});

test("finance parent: aucun enfant lié = fail-closed", () => {
  const principal = { role: "Parent", roleKeys: ["PARENT"], studentIds: [] };
  assert.deepEqual(
    filterFinanceRowsForLinkedStudent([{ id: "fee-a", studentId: A_CODE }], principal),
    [],
  );
});

test("finance staff: garde son dataset métier", () => {
  const rows = [
    { id: "fee-a", studentId: A_CODE },
    { id: "fee-b", studentId: B_CODE },
  ];
  assert.deepEqual(
    filterFinanceRowsForLinkedStudent(rows, { role: "Comptable" }),
    rows,
  );
});

test("impayés parent: aucune ligne d'un autre enfant n'est exposée", () => {
  const service = new UnpaidService();
  const state = {
    students: [
      { id: A_UUID, studentCode: A_CODE, schoolCode: "CD-IN-26-001" },
      { id: B_UUID, studentCode: B_CODE, schoolCode: "CD-IN-26-001" },
    ],
    studentFees: [
      {
        id: "fee-a",
        studentId: A_CODE,
        studentName: "Enfant A",
        schoolCode: "CD-IN-26-001",
        className: "6e A",
        label: "Scolarité",
        amountDue: 100,
        amountPaid: 0,
        exemption: 0,
        balance: 100,
        status: "En retard",
        currency: "CDF",
        periodLabel: "T1",
        dueDate: "01-01-2026",
      },
      {
        id: "fee-b",
        studentId: B_CODE,
        studentName: "Enfant B",
        schoolCode: "CD-IN-26-001",
        className: "6e A",
        label: "Scolarité",
        amountDue: 900,
        amountPaid: 0,
        exemption: 0,
        balance: 900,
        status: "En retard",
        currency: "CDF",
        periodLabel: "T1",
        dueDate: "01-01-2026",
      },
    ],
    paymentReminders: [],
    payments: [],
  };

  const result = service.list(state, parent(), {}, new Date("2026-09-22T12:00:00Z"));
  assert.deepEqual(result.rows.map((row) => row.studentId), [A_CODE]);
  assert.deepEqual(result.fees.map((row) => row.id), ["fee-a"]);
  assert.equal(result.dashboard.totalAmountDue, 100);
});

test("impayés parent: détail d'un enfant étranger = 404", () => {
  const service = new UnpaidService();
  const state = {
    students: [
      { id: A_UUID, studentCode: A_CODE, schoolCode: "CD-IN-26-001" },
      { id: B_UUID, studentCode: B_CODE, schoolCode: "CD-IN-26-001" },
    ],
    studentFees: [
      {
        id: "fee-b",
        studentId: B_CODE,
        studentName: "Enfant B",
        schoolCode: "CD-IN-26-001",
        className: "6e A",
        label: "Scolarité",
        amountDue: 900,
        amountPaid: 0,
        exemption: 0,
        balance: 900,
        status: "En retard",
        currency: "CDF",
        periodLabel: "T1",
        dueDate: "01-01-2026",
      },
    ],
    paymentReminders: [],
    payments: [],
  };

  assert.throws(
    () => service.detail(state, parent(), B_CODE),
    (error) => error && error.statusCode === 404,
  );
});
