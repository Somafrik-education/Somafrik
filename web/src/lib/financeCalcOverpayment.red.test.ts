import { describe, expect, it } from "vitest";
import { financeObligationStatusLabel, financePaymentStatusLabel } from "./financeObligationStatus";
import { getPaymentRateKpi } from "./paymentRateKpi";
import { studentFeeSummary } from "./fees";
import { aggregateUnpaidByStudent, listUnpaidStudentFees } from "./unpaidModule";
import type { BackOfficeState, StudentFee } from "../types";

/**
 * FIN-CALC-RED-015 — une obligation soldée + trop-perçu 1 CDF
 * doit produire le même solde/statut sur toutes les projections Web.
 * Le statut d'encaissement « Partiel » ne doit pas être lu comme
 * statut d'obligation « Partiellement payé ».
 */

const obligation = {
  id: "obl-oscar-sep",
  studentId: "CD-IN-TNT-26-00019",
  studentName: "Oscar Mukwege",
  schoolCode: "CD-IN-26-001",
  className: "6ème A",
  schoolFeeItemId: "item-sco",
  feeGridId: "grid-1",
  feeType: "Scolarité",
  label: "Frais scolaire — Septembre",
  currency: "CDF",
  academicYear: "2025-2026",
  initialAmount: 1,
  discount: 0,
  exemption: 0,
  amountDue: 1,
  amountPaid: 1,
  balance: 0,
  status: "Payé" as const,
  dueDate: "2026-09-01",
  periodLabel: "Septembre",
} satisfies StudentFee;

const payment = {
  id: "CD-IN-26-001-2026-PAY-0006",
  reference: "CD-IN-26-001-2026-PAY-0006",
  studentId: obligation.studentId,
  amount: 2,
  allocatedAmount: 1,
  unallocatedAmount: 1,
  status: "Partiel",
  currency: "CDF",
};

function emptyState(fees: StudentFee[]): BackOfficeState {
  return {
    schools: [{ id: "sch", code: "CD-IN-26-001", name: "Lycée", currency: "CDF" }],
    users: [],
    countries: [],
    contacts: [],
    relations: [],
    subscriptions: [],
    notifications: [],
    students: [
      {
        id: obligation.studentId,
        name: "Oscar Mukwege",
        firstName: "Oscar",
        lastName: "Mukwege",
        matricule: obligation.studentId,
        schoolId: "sch",
        schoolCode: "CD-IN-26-001",
        className: "6ème A",
      },
    ] as never,
    teachers: [],
    classes: [],
    courses: [],
    assignments: [],
    payments: [payment as never],
    presences: [],
    notes: [],
    exams: [],
    bulletins: [],
    documents: [],
    announcements: [],
    messages: [],
    paymentStatuses: [],
    studentFees: fees,
    paymentReminders: [],
    rolePermissions: {},
    academicConfigs: {},
  };
}

describe("FIN-CALC-RED-015 — projections Web d'une obligation soldée", () => {
  it("FIN-CALC-RED-015 one canonical obligation produces same balance/status on every Web projection", () => {
    expect(obligation.balance).toBe(0);
    expect(obligation.status).toBe("Payé");
    expect(financeObligationStatusLabel(obligation.status)).toBe("Payé");

    const summary = studentFeeSummary([obligation]);
    expect(summary.totalBalance).toBe(0);
    expect(summary.totalPaid).toBe(1);

    const kpi = getPaymentRateKpi([obligation]);
    expect(kpi.expectedAmount).toBe(1);
    expect(kpi.collectedAmount).toBe(1);
    expect(kpi.rate).toBe(100);

    const state = emptyState([obligation]);
    const unpaidFees = listUnpaidStudentFees(state, {
      id: "u1",
      role: "Comptable",
      schoolCode: "CD-IN-26-001",
      permissions: ["Impayés:READ"],
    } as never);
    expect(unpaidFees).toHaveLength(0);
    const unpaidRows = aggregateUnpaidByStudent(unpaidFees, [], state);
    expect(unpaidRows.find((row) => row.studentId === obligation.studentId)).toBeUndefined();

    // Table Paiements : aujourd'hui financePaymentStatusLabel("Partiel") = "Partiellement payé"
    // alors que l'obligation est Payé. Le trop-perçu ne doit pas usurper le vocabulaire de créance.
    expect(financePaymentStatusLabel(payment.status)).not.toBe("Partiellement payé");
    expect(financePaymentStatusLabel("Partiel")).not.toBe(financeObligationStatusLabel("Partiellement payé"));
  });
});
