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

test("une obligation ouverte sans inscription active reste visible et n'est pas encaissable", () => {
  const state = unpaidState([]);
  state.studentFees[0].studentDbId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  state.studentFees[0].studentCode = "CD-IN-ME-26-00010";
  state.studentFees[0].hasActiveEnrollment = false;
  state.studentFees[0].amountDue = 320000;
  state.studentFees[0].balance = 320000;

  const result = new UnpaidService().list(state, { schoolCode: "CD-2026-0001" });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].amountDue, 320000);
  assert.equal(result.rows[0].collectionEligible, false);
  assert.equal(result.rows[0].integrityCategory, "no_active_enrollment");
  assert.equal(result.rows[0].canonicalStudentId, "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
});

test("un élève inscrit dont l'identifiant public diverge reste encaissable via l'UUID", () => {
  const state = unpaidState([]);
  state.studentFees[0].studentId = "profile-legacy";
  state.studentFees[0].studentDbId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  state.studentFees[0].studentCode = "CD-IN-ME-26-00010";
  state.studentFees[0].hasActiveEnrollment = true;

  const result = new UnpaidService().list(state, { schoolCode: "CD-2026-0001" });

  assert.equal(result.rows[0].collectionEligible, true);
  assert.equal(result.rows[0].integrityCategory, "identity_mismatch");
  assert.equal(result.rows[0].canonicalStudentId, "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
  assert.equal(result.rows[0].amountDue, 100000);
});

test("inscription non vérifiée et identité absente restent visibles sans devenir encaissables", () => {
  const unverified = unpaidState([]);
  unverified.studentFees[0].studentDbId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  unverified.studentFees[0].studentCode = "CD-IN-ME-26-00010";
  unverified.studentFees[0].balance = 320000;
  unverified.studentFees[0].amountDue = 320000;
  const undefinedEnrollment = new UnpaidService().list(unverified, { schoolCode: "CD-2026-0001" });
  assert.equal(undefinedEnrollment.rows[0].amountDue, 320000);
  assert.equal(undefinedEnrollment.rows[0].collectionEligible, false);
  assert.equal(undefinedEnrollment.rows[0].integrityCategory, "no_active_enrollment");

  const nulled = unpaidState([]);
  nulled.studentFees[0].studentDbId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  nulled.studentFees[0].studentCode = "CD-IN-ME-26-00010";
  nulled.studentFees[0].hasActiveEnrollment = null;
  nulled.studentFees[0].balance = 320000;
  nulled.studentFees[0].amountDue = 320000;
  const nullEnrollment = new UnpaidService().list(nulled, { schoolCode: "CD-2026-0001" });
  assert.equal(nullEnrollment.rows[0].collectionEligible, false);
  assert.equal(nullEnrollment.rows[0].amountDue, 320000);

  const missing = unpaidState([]);
  missing.studentFees[0].studentId = "profile-legacy";
  missing.studentFees[0].studentDbId = "profile-legacy";
  missing.studentFees[0].balance = 320000;
  missing.studentFees[0].amountDue = 320000;
  const absentIdentity = new UnpaidService().list(missing, { schoolCode: "CD-2026-0001" });
  assert.equal(absentIdentity.rows[0].canonicalStudentId, "");
  assert.equal(absentIdentity.rows[0].collectionEligible, false);
  assert.equal(absentIdentity.rows[0].amountDue, 320000);
  assert.equal(absentIdentity.rows[0].integrityCategory, "orphan_finance");
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

function multiPeriodState() {
  return {
    students: [
      {
        id: "ELE-2026-0001",
        publicId: "ELE-2026-0001",
        matricule: "CD-LAC-AE-26-00001",
        studentCode: "CD-LAC-AE-26-00001",
        name: "Amina K.",
      },
    ],
    studentFees: [
      {
        id: "FEE-T1",
        studentId: "ELE-2026-0001",
        studentName: "Amina K.",
        schoolCode: "CD-2026-0001",
        className: "1ère A",
        periodLabel: "T1 2026",
        amountDue: 30_000,
        amountPaid: 0,
        exemption: 0,
        balance: 30_000,
        currency: "CDF",
        dueDate: "2026-01-15",
        status: "En retard",
      },
      {
        id: "FEE-T2",
        studentId: "ELE-2026-0001",
        studentName: "Amina K.",
        schoolCode: "CD-2026-0001",
        className: "1ère A",
        periodLabel: "T2 2026",
        amountDue: 20_000,
        amountPaid: 0,
        exemption: 0,
        balance: 20_000,
        currency: "CDF",
        dueDate: "2026-04-15",
        status: "En retard",
      },
    ],
    paymentReminders: [],
  };
}

test("list filtre la période avant agrégation — même élève T1+T2", () => {
  const service = new UnpaidService();
  const principal = { schoolCode: "CD-2026-0001" };
  const state = multiPeriodState();

  const all = service.list(state, principal);
  assert.equal(all.rows.length, 1);
  assert.equal(all.rows[0].amountDue, 50_000);
  assert.equal(all.rows[0].periodLabel, "Plusieurs périodes");
  assert.equal(all.rows[0].matricule, "CD-LAC-AE-26-00001");
  assert.equal(all.fees.length, 2);

  const t1 = service.list(state, principal, { period: "T1 2026" });
  assert.equal(t1.rows.length, 1);
  assert.equal(t1.rows[0].studentId, "ELE-2026-0001");
  assert.equal(t1.rows[0].amountDue, 30_000);
  assert.equal(t1.rows[0].periodLabel, "T1 2026");
  assert.equal(t1.fees.length, 1);

  const t2 = service.list(state, principal, { period: "T2 2026" });
  assert.equal(t2.rows.length, 1);
  assert.equal(t2.rows[0].amountDue, 20_000);
  assert.equal(t2.rows[0].periodLabel, "T2 2026");

  const mixed = service.list(
    {
      ...state,
      studentFees: [
        ...state.studentFees,
        {
          id: "FEE-USD",
          studentId: "ELE-2026-0002",
          studentName: "Ben L.",
          schoolCode: "CD-2026-0001",
          className: "2nde B",
          periodLabel: "T1 2026",
          amountDue: 80,
          amountPaid: 0,
          exemption: 0,
          balance: 80,
          currency: "USD",
          dueDate: "2026-01-15",
          status: "En retard",
        },
      ],
    },
    principal,
  );
  assert.equal(new Set(mixed.rows.map((row) => row.currency)).size, 2);
});
