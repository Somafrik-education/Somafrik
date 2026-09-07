import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaymentReceipt } from "./PaymentReceipt";

describe("PaymentReceipt multi-libellés", () => {
  it("affiche toutes les lignes et le total général", () => {
    render(
      <PaymentReceipt
        payment={{
          reference: "CD-2026-0001-2026-PAY-0004",
          studentName: "Esther Okito",
          className: "6ème A",
          items: [
            { feeLabel: "Minerval", amount: 500 },
            { feeLabel: "Frais d'examen", amount: 1 },
            { feeLabel: "Frais de cantine", amount: 40 },
          ],
          method: "Espèces",
          date: "2026-08-19",
          status: "Payé",
          currency: "CDF",
        }}
      />,
    );
    expect(screen.getByText("Minerval")).toBeInTheDocument();
    expect(screen.getByText("Frais d'examen")).toBeInTheDocument();
    expect(screen.getByText("Frais de cantine")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("CD-2026-0001-2026-PAY-0004")).toBeInTheDocument();
  });

  it("affiche le nom du saisissant plutôt que son code utilisateur", () => {
    render(
      <PaymentReceipt
        payment={{
          reference: "CD-2026-0001-2026-PAY-0007",
          studentName: "Maeva O'gulgune",
          className: "2ème A",
          items: [{ feeLabel: "Scolarité", amount: 150 }],
          amount: 150,
          method: "Espèces",
          date: "2026-08-24",
          status: "Non imputé",
          currency: "CDF",
          createdBy: "USR-2026-00005",
        }}
        enteredByName="Administrateur Nuru"
      />,
    );

    expect(screen.getByText("Saisi par")).toBeInTheDocument();
    expect(screen.getByText("Administrateur Nuru")).toBeInTheDocument();
    expect(screen.queryByText("USR-2026-00005")).not.toBeInTheDocument();
  });
});
