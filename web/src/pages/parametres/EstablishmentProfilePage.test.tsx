import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { School } from "../../types";

const { showToast, refresh, update, school } = vi.hoisted(() => {
  const school = {
    code: "SCH-001",
    name: "Lycée Test",
    type: "Lycée",
    address: "1 rue Test",
    phone: "+221770000000",
    email: "contact@test.sn",
    city: "Dakar",
    country: "Sénégal",
    logoUrl: "",
    principalName: "Directeur Test",
    principalEmail: "dir@test.sn",
    principalPhone: "+221770000001",
  } as School;

  return {
    school,
    showToast: vi.fn(),
    refresh: vi.fn(),
    update: vi.fn(),
  };
});

vi.mock("../../context/DataContext", () => ({
  useData: () => ({
    state: { schools: [school] },
    refresh,
  }),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({ activeSchool: school }),
}));

vi.mock("../../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({ user: { role: "Admin School" } }),
}));

vi.mock("../../lib/permissions", () => ({
  canManageEstablishmentSettings: () => true,
}));

vi.mock("../../lib/establishmentsApi", () => ({
  establishmentsApi: { update },
}));

vi.mock("../../components/ui/Toast", () => ({
  useToast: () => ({ showToast }),
}));

import { EstablishmentProfilePage } from "./EstablishmentProfilePage";

describe("EstablishmentProfilePage (D2.3 migration)", () => {
  beforeEach(() => {
    showToast.mockReset();
    refresh.mockReset();
    update.mockReset();
  });

  it("renders FormLayout zones and DS primary submit", () => {
    render(<EstablishmentProfilePage />);

    expect(screen.getByRole("heading", { name: "Profil établissement" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Nom de l'établissement/i)).toHaveValue("Lycée Test");
    expect(screen.getByLabelText(/^Type/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer" })).toHaveAttribute("type", "submit");
    expect(screen.getByLabelText("Actions du formulaire")).toBeInTheDocument();
    expect(screen.getByLabelText("Formulaire")).toBeInTheDocument();
  });

  it("exposes section landmarks for keyboard / AT navigation", () => {
    render(<EstablishmentProfilePage />);

    expect(screen.getByRole("heading", { name: "Identité" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Localisation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Contacts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Responsable légal" })).toBeInTheDocument();
  });
});
