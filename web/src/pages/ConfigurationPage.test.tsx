import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const yearPermissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: false,
}));

const academicYearsApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

const showToast = vi.hoisted(() => vi.fn());

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: { id: "u1", role: "Admin School", schoolCode: "SCH-001", name: "Admin" },
    },
  }),
}));

vi.mock("../context/DataContext", () => ({
  useData: () => ({
    state: {
      academicConfigs: {
        "SCH-001": { periodMode: "trimestre", periods: [], defaultScale: 20 },
      },
    },
    invalidateDomains: vi.fn(),
    ensureDomains: vi.fn(),
  }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    activeSchoolCode: "SCH-001",
    activeSchool: { code: "SCH-001", name: "Lycée Test", city: "Kinshasa" },
    availableSchools: [{ code: "SCH-001", name: "Lycée Test", city: "Kinshasa" }],
    requiresSelection: false,
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({ user: { role: "Admin School", schoolCode: "SCH-001" } }),
  useFeaturePermissions: (feature: string) => {
    if (feature === "Années Académiques") return { ...yearPermissions };
    return { canRead: true, canCreate: true, canUpdate: true, canDelete: false };
  },
}));

vi.mock("../lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/permissions")>();
  return {
    ...actual,
    canAccessSchoolBackOffice: () => true,
    canManageEstablishmentSettings: () => true,
  };
});

vi.mock("../lib/academicYearsApi", () => ({ academicYearsApi: academicYearsApiMock }));

vi.mock("../lib/schoolSettingsApi", () => ({
  schoolSettingsApi: { patch: vi.fn(), replacePeriods: vi.fn() },
}));

vi.mock("../lib/establishmentRolesApi", () => ({
  establishmentRolesApi: { listAssignable: vi.fn().mockResolvedValue({ roles: [] }) },
}));

vi.mock("../design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../design-system")>();
  return {
    ...actual,
    useToast: () => ({ showToast }),
  };
});

import { ConfigurationPage } from "./ConfigurationPage";

describe("ConfigurationPage année scolaire (socle academic_years)", () => {
  beforeEach(() => {
    yearPermissions.canRead = true;
    yearPermissions.canCreate = true;
    yearPermissions.canUpdate = true;
    academicYearsApiMock.list.mockReset();
    academicYearsApiMock.create.mockReset();
    academicYearsApiMock.update.mockReset();
    showToast.mockReset();
    academicYearsApiMock.list.mockResolvedValue([]);
  });

  it("affiche le formulaire de création sans dates 01/09–31/08 et bloque les périodes", async () => {
    render(
      <MemoryRouter>
        <ConfigurationPage section="annee-scolaire" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Année scolaire / académique" })).toBeInTheDocument();
    expect(await screen.findByText(/Aucune année configurée/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Nom de l'année/)).toHaveValue("");
    expect(screen.getByLabelText(/Nom de l'année/)).toHaveAttribute("placeholder", "2026-2027");
    expect(screen.getByLabelText(/Début de l'année/)).toHaveValue("");
    expect(screen.getByLabelText(/Fin de l'année/)).toHaveValue("");
    expect(screen.getByRole("button", { name: "Créer l'année" })).toBeInTheDocument();
    expect(screen.getByText(/Impossible d'enregistrer les périodes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  });

  it("crée une année depuis Paramètres", async () => {
    const user = userEvent.setup();
    academicYearsApiMock.create.mockResolvedValue({
      id: "ay-new",
      schoolCode: "SCH-001",
      name: "2026-2027",
      startDate: "2026-10-01",
      endDate: "2027-07-31",
      status: "Ouverte",
      isCurrent: true,
    });
    academicYearsApiMock.list
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          id: "ay-new",
          schoolCode: "SCH-001",
          name: "2026-2027",
          startDate: "2026-10-01",
          endDate: "2027-07-31",
          status: "Ouverte",
          isCurrent: true,
        },
      ]);

    render(
      <MemoryRouter>
        <ConfigurationPage section="annee-scolaire" />
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "Créer l'année" });
    await user.type(screen.getByLabelText(/Nom de l'année/), "2026-2027");
    await user.type(screen.getByLabelText(/Début de l'année/), "2026-10-01");
    await user.type(screen.getByLabelText(/Fin de l'année/), "2027-07-31");
    await user.click(screen.getByRole("button", { name: "Créer l'année" }));

    await waitFor(() => {
      expect(academicYearsApiMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "2026-2027",
          startDate: "2026-10-01",
          endDate: "2027-07-31",
          isCurrent: true,
        }),
      );
    });
    expect(await screen.findByText("2026-2027")).toBeInTheDocument();
  });
});
