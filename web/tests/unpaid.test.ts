import { describe, it, expect } from "vitest";

import {
  computeDaysLate,
  computeUnpaidSeverity,
  isOverdueStudentFee,
  aggregateUnpaidByStudent,
  buildUnpaidDashboard,
  canSendReminder,
  buildReminderMessage,
} from "../src/lib/unpaidModule";
import type { BackOfficeState, PaymentReminder, StudentFee } from "../src/types";

const state = {
  students: [
    { id: "STU-1", name: "Marie Kabila", matricule: "ELE-001", className: "6A", schoolCode: "SCH1" },
  ],
} as unknown as BackOfficeState;

function makeFee(overrides: Partial<StudentFee> = {}): StudentFee {
  return {
    id: "FEE-1",
    studentId: "STU-1",
    studentName: "Marie Kabila",
    className: "6A",
    schoolCode: "SCH1",
    label: "Inscription",
    amountDue: 50_000,
    amountPaid: 10_000,
    balance: 40_000,
    currency: "CDF",
    status: "En retard",
    dueDate: "15-06-2026",
    periodLabel: "T1",
    academicYear: "2025-2026",
    ...overrides,
  } as StudentFee;
}

describe("Impayés", () => {
  it("calcule les jours de retard", () => {
    const now = new Date(2026, 6, 10);
    expect(computeDaysLate("01-06-2026", now)).toBeGreaterThan(0);
    expect(computeDaysLate("15-07-2026", now)).toBe(0);
  });

  it("attribue la criticité selon le retard", () => {
    expect(computeUnpaidSeverity(3)).toBe("Retard léger");
    expect(computeUnpaidSeverity(15)).toBe("Retard moyen");
    expect(computeUnpaidSeverity(45)).toBe("Retard critique");
  });

  it("détecte un frais en retard", () => {
    const now = new Date(2026, 6, 10);
    expect(isOverdueStudentFee(makeFee(), now)).toBe(true);
    expect(isOverdueStudentFee(makeFee({ status: "Payé", balance: 0 }), now)).toBe(false);
  });

  it("agrège les impayés par élève", () => {
    const fees = [makeFee(), makeFee({ id: "FEE-2", label: "Mensualité", balance: 20_000 })];
    const rows = aggregateUnpaidByStudent(fees, [], state);
    expect(rows).toHaveLength(1);
    expect(rows[0].studentId).toBe("STU-1");
    expect(rows[0].amountDue).toBe(60_000);
    expect(rows[0].severity).toBe("Retard moyen");
  });

  it("construit les statistiques du tableau de bord impayés", () => {
    const rows = aggregateUnpaidByStudent([makeFee()], [], state);
    const stats = buildUnpaidDashboard(rows);
    expect(stats.studentCount).toBe(1);
    expect(stats.totalAmountDue).toBe(40_000);
    expect(stats.byClass[0].className).toBe("6A");
  });

  it("refuse une relance en doublon le même jour", () => {
    const now = new Date(2026, 6, 10, 12, 0, 0);
    const reminders: PaymentReminder[] = [
      {
        id: "REM-1",
        studentId: "STU-1",
        sentAt: now.toISOString(),
        sendStatus: "Envoyée",
        schoolCode: "SCH1",
      } as PaymentReminder,
    ];
    const result = canSendReminder(reminders, "STU-1", 3, now);
    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/relance/i);
  });

  it("autorise une relance après le délai de cooldown", () => {
    const now = new Date(2026, 6, 10);
    const reminders: PaymentReminder[] = [
      {
        id: "REM-1",
        studentId: "STU-1",
        sentAt: new Date(2026, 6, 1).toISOString(),
        sendStatus: "Envoyée",
        schoolCode: "SCH1",
      } as PaymentReminder,
    ];
    expect(canSendReminder(reminders, "STU-1", 3, now).allowed).toBe(true);
  });

  it("génère un message de relance personnalisé", () => {
    const rows = aggregateUnpaidByStudent([makeFee()], [], state);
    const message = buildReminderMessage(rows[0], "École Test");
    expect(message).toMatch(/Marie Kabila/);
    expect(message).toMatch(/40[\s\u00a0]?000/);
    expect(message).toMatch(/École Test/);
  });
});
