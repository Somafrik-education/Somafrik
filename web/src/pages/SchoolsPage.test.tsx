import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { School } from "../types";

const { showToast, refresh, update, create, patch, school } = vi.hoisted(() => {
  const school = {
    code: "CD-2026-0001",
    publicId: "CD-IK-26-001",
    name: "Lycée Test",
    type: "Lycée",
    city: "Kinshasa",
    country: "RDC",
    countryCode: "CD",
    status: "Actif",
    validationStatus: "Validé",
    principalName: "Awa Kabila",
  } as School;

  return {
    school,
    showToast: vi.fn(),
    refresh: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    patch: vi.fn(),
  };
});

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return actual;
});

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        role: "Super Administrateur Somafrik",
        identifier: "superadmin",
      },
    },
  }),
}));

vi.mock("../context/DataContext", () => ({
  useData: () => ({
    state: {
      schools: [school],
      countries: [{ name: "RDC", code: "CD", status: "Actif" }],
      users: [],
      students: [],
      auditLog: [],
    },
    refresh,
    update,
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({
    user: { role: "Super Administrateur Somafrik" },
  }),
  useFeaturePermissions: () => ({
    canCreate: true,
    canUpdate: true,
    canSuspend: true,
    canDelete: true,
  }),
}));

vi.mock("../lib/permissions", () => ({
  canManageRolePermissions: () => true,
}));

vi.mock("../lib/establishmentsApi", () => ({
  establishmentsApi: {
    create,
    update: patch,
    activate: vi.fn(),
    suspend: vi.fn(),
    remove: vi.fn(),
    importRows: vi.fn(),
  },
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast }),
}));

import { SchoolsPage } from "./SchoolsPage";

describe("SchoolsPage (LOT 1 — API establishments)", () => {
  beforeEach(() => {
    showToast.mockReset();
    refresh.mockReset();
    update.mockReset();
    create.mockReset();
    patch.mockReset();
  });

  it("liste les établissements et expose la création via l'API dédiée", () => {
    render(
      <MemoryRouter>
        <SchoolsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Établissements")).toBeInTheDocument();
    expect(screen.getByText("Lycée Test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nouvel établissement" })).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("affiche le code public canonique sans exposer l'ancien code interne", () => {
    render(
      <MemoryRouter>
        <SchoolsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("CD-IK-26-001")).toBeInTheDocument();
    expect(screen.queryByText("CD-2026-0001")).not.toBeInTheDocument();
  });

  it("n'impose pas countries[0] / RDC à l'ouverture du formulaire Superadmin", () => {
    render(
      <MemoryRouter>
        <SchoolsPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Nouvel établissement" }));
    const country = screen.getByLabelText(/^Pays/i) as HTMLSelectElement;
    expect(country.value).toBe("");
    expect(screen.getByText("Choisir un pays…")).toBeInTheDocument();
  });
});
