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
    session: {
      user: {
        role: "Admin School",
        schoolCode: "CD-2026-0001",
        permissions: ["Frais & tarifs:READ", "Frais & tarifs:CREATE", "Frais & tarifs:UPDATE"],
      },
    },
    permissionsReady: true,
  }),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    activeSchool: { name: "Lycée A", code: "CD-2026-0001" },
  }),
}));

vi.mock("../../lib/feePermissions", () => ({
  canReadFees: vi.fn(() => true),
  canCreateFees: vi.fn(() => true),
  canUpdateFees: vi.fn(() => true),
}));

vi.mock("../../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { canCreateFees, canReadFees, canUpdateFees } from "../../lib/feePermissions";
import { SettingsFinancePage } from "./SettingsFinancePage";

const mockedCanReadFees = vi.mocked(canReadFees);
const mockedCanCreateFees = vi.mocked(canCreateFees);
const mockedCanUpdateFees = vi.mocked(canUpdateFees);

describe("SettingsFinancePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCanReadFees.mockReturnValue(true);
    mockedCanCreateFees.mockReturnValue(true);
    mockedCanUpdateFees.mockReturnValue(true);
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

  it("refuse l'accès sans permission de lecture", async () => {
    mockedCanReadFees.mockReturnValue(false);
    mockedCanCreateFees.mockReturnValue(false);
    mockedCanUpdateFees.mockReturnValue(false);
    render(
      <MemoryRouter>
        <SettingsFinancePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Les règles financières se configurent ici/i)).toBeInTheDocument();
    expect(getFinanceCatalog).not.toHaveBeenCalled();
  });

  it("affiche l'état vide sans grille tarifaire", async () => {
    listFeeGrids.mockResolvedValue([]);
    getFinanceCatalog.mockResolvedValue({
      currency: "CDF",
      currencySource: "country",
      paymentMethods: [{ methodCode: "cash", label: "Espèces", active: true, sortOrder: 10 }],
      feeTypes: [],
      canonicalFeeTypes: [{ feeType: "Inscription", label: "Inscription" }],
      discountsDeferred: true,
      penaltiesDeferred: true,
    });
    render(
      <MemoryRouter>
        <SettingsFinancePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Aucune grille tarifaire")).toBeInTheDocument();
    expect(screen.queryByText("Bientôt disponible")).not.toBeInTheDocument();
  });
});
