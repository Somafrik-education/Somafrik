import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FinancePaymentsOverview } from "./FinancePaymentsOverview";
import { formatPaymentOverviewAmounts } from "../../lib/paymentAmountBreakdown";
import type { StudentFeeObligation } from "../../lib/paymentRateKpi";

function obligation(
  studentId: string,
  extras: Partial<StudentFeeObligation> = {},
): StudentFeeObligation {
  return {
    studentId,
    amountDue: 1000,
    amountPaid: 0,
    exemption: 0,
    status: "À payer",
    ...extras,
  };
}

describe("FinancePaymentsOverview — FIN-L3", () => {
  it("FIN-L3-01-A/B affiche CDF et USD, jamais un 0 USD artificiel", () => {
    const fees = [
      obligation("s-cdf", { amountDue: 100_000, amountPaid: 20_000, currency: "CDF" }),
      obligation("s-usd", { amountDue: 50, amountPaid: 10, currency: "USD" }),
    ];
    const formatted = formatPaymentOverviewAmounts(fees);
    render(
      <FinancePaymentsOverview
        expectedLabel={formatted.expectedLabel}
        collectedLabel={formatted.collectedLabel}
        remainingLabel={formatted.remainingLabel}
        obligationCount={2}
        recentPaymentCount={0}
      />,
    );
    expect(screen.queryByText(/^(0[\s\u00a0\u202f]+USD)$/m)).not.toBeInTheDocument();
    expect(screen.getByText(/100[\s\u00a0\u202f]?000 CDF/)).toBeInTheDocument();
    expect(screen.getByText(/50 USD/)).toBeInTheDocument();
    expect(screen.getByText(/20[\s\u00a0\u202f]?000 CDF/)).toBeInTheDocument();
    expect(screen.getByText(/80[\s\u00a0\u202f]?000 CDF/)).toBeInTheDocument();
  });

  it("FIN-L3-03 libellé Obligations élèves, pas Obligations ni Tarifs", () => {
    render(
      <FinancePaymentsOverview
        expectedLabel="—"
        collectedLabel="—"
        remainingLabel="—"
        obligationCount={41}
        recentPaymentCount={0}
      />,
    );
    expect(screen.getByText("Obligations élèves")).toBeInTheDocument();
    expect(screen.queryByText(/^Obligations$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tarifs/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Frais configurés/)).not.toBeInTheDocument();
    expect(screen.getByText("41")).toBeInTheDocument();
  });
});
