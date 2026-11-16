import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { FinancePaymentsOverview } from "./FinancePaymentsOverview";
import { formatPaymentOverviewAmounts } from "../../lib/paymentAmountBreakdown";
import type { StudentFeeObligation } from "../../lib/paymentRateKpi";

function obligation(studentId: string, extras: Partial<StudentFeeObligation> = {}): StudentFeeObligation {
  return {
    studentId,
    amountDue: 1000,
    amountPaid: 0,
    exemption: 0,
    status: "À payer",
    ...extras,
  };
}

describe("FinancePaymentsOverview — FIN-L3 / FIN-SIMPLE-02", () => {
  it("FIN-L3-01-A/B conserve CDF et USD séparés, jamais un 0 USD artificiel", () => {
    const fees = [
      obligation("s-cdf", { amountDue: 100_000, amountPaid: 20_000, currency: "CDF" }),
      obligation("s-usd", { amountDue: 50, amountPaid: 10, currency: "USD" }),
    ];
    const formatted = formatPaymentOverviewAmounts(fees);
    render(
      <FinancePaymentsOverview
        expectedLabel={formatted.expectedLabel}
        cashLabel="—"
        allocatedLabel={formatted.collectedLabel}
        remainingLabel={formatted.remainingLabel}
        obligationCount={2}
        recentPaymentCount={0}
      />,
    );
    const summary = screen.getByRole("region", { name: "Synthèse financière" });
    expect(within(summary).queryByText(/^(0[\s\u00a0\u202f]+USD)$/m)).not.toBeInTheDocument();
    expect(within(summary).getByText(/100[\s\u00a0\u202f]?000 CDF/)).toBeInTheDocument();
    expect(within(summary).getByText(/50 USD/)).toBeInTheDocument();
    expect(within(summary).getByText(/80[\s\u00a0\u202f]?000 CDF/)).toBeInTheDocument();
    expect(within(summary).getByText(/40 USD/)).toBeInTheDocument();
    expect(within(summary).queryByText(/20[\s\u00a0\u202f]?000 CDF/)).not.toBeInTheDocument();
  });

  it("FIN-12 affiche exactement les trois KPI demandés, sans compteurs ni carte d'imputation", () => {
    render(
      <FinancePaymentsOverview
        expectedLabel="—"
        cashLabel="—"
        allocatedLabel="—"
        remainingLabel="—"
        obligationCount={41}
        recentPaymentCount={7}
      />,
    );
    const summary = screen.getByRole("region", { name: "Synthèse financière" });
    expect(within(summary).getAllByText(/^(Obligation|Encaissé|Reste à payer)$/).map((node) => node.textContent)).toEqual([
      "Obligation",
      "Encaissé",
      "Reste à payer",
    ]);
    expect(within(summary).queryByText("Obligations élèves")).not.toBeInTheDocument();
    expect(within(summary).queryByText("Paiements récents")).not.toBeInTheDocument();
    expect(within(summary).queryByText(/imputé/i)).not.toBeInTheDocument();
    expect(within(summary).queryByText("41")).not.toBeInTheDocument();
    expect(within(summary).queryByText("7")).not.toBeInTheDocument();
  });

  it("FIN-L3-04-C Encaissé est le cash, jamais amountPaid d'obligation", () => {
    render(
      <FinancePaymentsOverview
        expectedLabel="100 000 CDF"
        cashLabel="150 CDF"
        allocatedLabel="20 000 CDF"
        remainingLabel="80 000 CDF"
        obligationCount={2}
        recentPaymentCount={1}
      />,
    );
    expect(screen.getByText("Encaissé")).toBeInTheDocument();
    expect(screen.getByText("150 CDF")).toBeInTheDocument();
    expect(screen.getByText("80 000 CDF")).toBeInTheDocument();
    expect(screen.queryByText("20 000 CDF")).not.toBeInTheDocument();
  });
});
