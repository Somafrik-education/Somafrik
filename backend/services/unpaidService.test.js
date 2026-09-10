const assert = require("node:assert/strict");
const test = require("node:test");

const { UnpaidService } = require("./unpaidService");

function unpaidState(paymentReminders) {
  return {
    studentFeeObligations: [],
    studentFees: [
      {
        id: "FEE-1",
        studentId: "ELE-2026-0001",
        studentName: "Élève Test",
        schoolCode: "CD-2026-0001",
        className: "1ère Primaire A",
        periodLabel: "Septembre 2026",
        amountDue: 100_000,
        amountPaid: 0,
        exemption: 0,
        balance: 100_000,
        currency: "CDF",
        dueDate: "2026-09-01",
        status: "En retard",
      },
    ],
    paymentReminders,
  };
}

test("list normalise les sentAt Date avant de déterminer la dernière relance", () => {
  const older = new Date("2026-09-08T10:00:00.000Z");
  const latest = new Date("2026-09-09T14:35:00.000Z");
  const state = unpaidState([
    { studentId: "ELE-2026-0001", sentAt: older },
    { studentId: "ELE-2026-0001", sentAt: latest },
  ]);

  const result = new UnpaidService().list(state, { schoolCode: "CD-2026-0001" });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].lastReminderAt, latest.toISOString());
  assert.equal(result.rows[0].reminderCount, 2);
});

test("list ignore un sentAt invalide sans provoquer de réponse 500", () => {
  const valid = "2026-09-09T14:35:00.000Z";
  const state = unpaidState([
    { studentId: "ELE-2026-0001", sentAt: { legacy: true } },
    { studentId: "ELE-2026-0001", sentAt: valid },
  ]);

  const result = new UnpaidService().list(state, { schoolCode: "CD-2026-0001" });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].lastReminderAt, valid);
  assert.equal(result.rows[0].reminderCount, 2);
});
