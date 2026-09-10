import { describe, expect, it } from "vitest";
import { buildUnpaidDashboard } from "./unpaidModule";
import type { StudentUnpaidRow } from "../types";

function row(overrides: Partial<StudentUnpaidRow> = {}): StudentUnpaidRow {
  return {
    studentId: "stu-1",
    studentName: "Ada",
    className: "6ème A",
    schoolCode: "SCH-A",
    periodLabel: "2025-2026",
    amountExpected: 100,
    amountPaid: 0,
    amountDue: 100,
    currency: "XOF",
    daysLate: 10,
    severity: "Retard moyen",
    status: "En retard",
    feeIds: ["fee-1"],
    reminderCount: 0,
    ...overrides,
  };
}

describe("buildUnpaidDashboard — devise", () => {
  it("n'invente pas USD/EUR/CDF si aucune ligne", () => {
    expect(buildUnpaidDashboard([]).currency).toBe("");
  });

  it("propage la devise de la première obligation", () => {
    expect(buildUnpaidDashboard([row({ currency: "xof" })]).currency).toBe("XOF");
    expect(buildUnpaidDashboard([row({ currency: "EUR" })]).currency).toBe("EUR");
  });

  it("ne publie pas une somme CDF+USD sous une seule devise", () => {
    const dashboard = buildUnpaidDashboard([
      row({ studentId: "cdf", amountDue: 120_000, currency: "CDF" }),
      row({ studentId: "usd", amountDue: 50, currency: "USD", className: "6ème B" }),
    ]);
    expect(dashboard.totalAmountDue).toBe(0);
    expect(dashboard.currency).toBe("");
    expect(dashboard.totalsByCurrency).toEqual([
      { currency: "CDF", amount: 120_000 },
      { currency: "USD", amount: 50 },
    ]);
  });
});
