import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OpenObligationCards } from "./OpenObligationCards";

describe("OpenObligationCards", () => {
  it("affiche le solde d'une obligation partiellement payée", () => {
    render(
      <OpenObligationCards
        currency="CDF"
        obligations={[
          {
            obligationId: "obl-1",
            label: "Scolarité T1",
            periodLabel: "T1",
            className: "6ème A",
            amountDue: 100000,
            amountPaid: 40000,
            balance: 60000,
            status: "Partiellement payé",
            currency: "CDF",
            dueDate: "2026-09-15",
          },
        ]}
      />,
    );
    expect(screen.getByText("Scolarité T1")).toBeInTheDocument();
    expect(screen.getByText("Partiellement payé")).toBeInTheDocument();
    expect(screen.getByText(/60[\s\u00a0]?000 CDF/)).toBeInTheDocument();
    expect(screen.getByText(/40[\s\u00a0]?000 CDF/)).toBeInTheDocument();
  });

  it("empty state si aucune obligation ouverte", () => {
    render(<OpenObligationCards currency="CDF" obligations={[]} />);
    expect(screen.getByText(/Aucune obligation ouverte/)).toBeInTheDocument();
  });
});
