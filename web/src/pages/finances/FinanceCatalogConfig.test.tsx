import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { FinanceCatalog } from "../../lib/financeApi";

const replacePaymentMethods = vi.fn();

vi.mock("../../lib/financeApi", () => ({
  financeApi: {
    replacePaymentMethods: (...args: unknown[]) => replacePaymentMethods(...args),
  },
}));

vi.mock("../../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { FinanceCatalogConfig } from "./FinanceCatalogConfig";

const CATALOG: FinanceCatalog = {
  currency: "CDF",
  currencySource: "country",
  paymentMethods: [{ methodCode: "cash", label: "Espèces", active: true, sortOrder: 10 }],
  feeTypes: [
    {
      itemId: "item-1",
      feeType: "Inscription",
      label: "Inscription",
      amount: 25000,
      currency: "CDF",
      className: "6ème A",
      academicYear: "2025-2026",
      dueDate: "2026-01-15",
      mandatory: true,
      active: true,
    },
  ],
  canonicalFeeTypes: [{ feeType: "Inscription", label: "Inscription" }],
  discountsDeferred: true,
  penaltiesDeferred: true,
};

describe("FinanceCatalogConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("affiche la devise, les moyens de paiement et l'alerte pénalités différées", () => {
    render(
      <MemoryRouter>
        <FinanceCatalogConfig catalog={CATALOG} canWrite />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Devise" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Moyens de paiement autorisés" })).toBeInTheDocument();
    expect(screen.queryByText("Bientôt disponible")).not.toBeInTheDocument();
    expect(screen.getAllByText("CDF").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Espèces").length).toBeGreaterThan(0);
    expect(screen.getByText(/différées V1/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer les moyens" })).toBeInTheDocument();
  });

  it("reste en lecture seule sans droit d'écriture", () => {
    render(
      <MemoryRouter>
        <FinanceCatalogConfig catalog={CATALOG} canWrite={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Seule l'administration peut modifier/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enregistrer les moyens" })).not.toBeInTheDocument();
    expect(replacePaymentMethods).not.toHaveBeenCalled();
  });

  it("affiche l'état vide sans moyen de paiement", () => {
    render(
      <MemoryRouter>
        <FinanceCatalogConfig catalog={{ ...CATALOG, paymentMethods: [] }} canWrite />
      </MemoryRouter>,
    );
    expect(screen.getByText("Aucun moyen configuré.")).toBeInTheDocument();
    expect(screen.queryByText("Bientôt disponible")).not.toBeInTheDocument();
  });
});
