import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const getFinanceCatalog = vi.fn();
const listFeeGrids = vi.fn();
const replacePaymentMethods = vi.fn();

vi.mock("../../lib/financeApi", () => ({
  financeApi: {
    getFinanceCatalog: (...args: unknown[]) => getFinanceCatalog(...args),
    listFeeGrids: (...args: unknown[]) => listFeeGrids(...args),
    replacePaymentMethods: (...args: unknown[]) => replacePaymentMethods(...args),
    createFeeGrid: vi.fn(),
    activateFeeGrid: vi.fn(),
    deactivateFeeGrid: vi.fn(),
  },
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    session: { user: { role: "Admin School", schoolCode: "CD-2026-0001" } },
  }),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    activeSchool: { name: "Lycée A", code: "CD-2026-0001" },
  }),
}));

vi.mock("../../lib/fees", () => ({
  canManageFeeGrids: () => true,
  canViewFeeGrids: () => true,
}));

vi.mock("../../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { SettingsFinancePage } from "./SettingsFinancePage";

describe("SettingsFinancePage", () => {
  beforeEach(() => {
    getFinanceCatalog.mockResolvedValue({
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
    });
    listFeeGrids.mockResolvedValue([{ id: "grid-1", className: "6ème A", academicYear: "2025-2026", currency: "CDF", status: "Active" }]);
  });

  it("remplace le placeholder par le catalogue PostgreSQL", async () => {
    render(
      <MemoryRouter>
        <SettingsFinancePage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Paramètres Finances" })).toBeInTheDocument();
    });
    expect(screen.queryByText("Bientôt disponible")).not.toBeInTheDocument();
    expect(screen.getAllByText("CDF").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Espèces").length).toBeGreaterThan(0);
    expect(screen.getByText(/25[\s\u00a0]?000/)).toBeInTheDocument();
    expect(screen.getByText(/différées V1/i)).toBeInTheDocument();
  });
});
