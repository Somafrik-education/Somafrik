/**
 * AUDIT-SETUP-GUIDED-10-01 — anomalie prod SCH-861371F01E094E9E8970 :
 * l'étape « Informations établissement » exige une adresse et une devise, mais le profil
 * laissait l'adresse facultative et n'affichait pas la devise. Le formulaire doit
 * annoncer la même exigence que l'assistant. Aucune valeur n'est inventée.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { School } from "../../types";

const { showToast, refresh, update, school } = vi.hoisted(() => {
  const school = {
    code: "SCH-001",
    name: "Lycée Test",
    type: "Lycée",
    address: "",
    currency: "BIF",
    phone: "+221770000000",
    email: "contact@test.sn",
    city: "Bujumbura",
    country: "BURUNDI",
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
  establishmentsApi: { update, uploadLogo: vi.fn(), removeLogo: vi.fn() },
}));

vi.mock("../../design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../design-system")>();
  return {
    ...actual,
    useToast: () => ({ showToast }),
  };
});

import { EstablishmentProfilePage } from "./EstablishmentProfilePage";

describe("EstablishmentProfilePage — exigences de l'étape 1 de la configuration guidée", () => {
  beforeEach(() => {
    showToast.mockReset();
    refresh.mockReset();
    update.mockReset();
    school.address = "";
  });

  it("l'adresse est un champ obligatoire, comme pour l'assistant", () => {
    render(<EstablishmentProfilePage />);
    expect(screen.getByLabelText(/^Adresse/)).toBeRequired();
  });

  it("la devise lue par l'assistant est visible (lecture seule)", () => {
    render(<EstablishmentProfilePage />);
    const currency = screen.getByLabelText(/^Devise/);
    expect(currency).toHaveValue("BIF");
    expect(currency).toHaveAttribute("readonly");
  });

  it("sans adresse, l'enregistrement est refusé avec un message explicite et rien n'est envoyé", async () => {
    const { container } = render(<EstablishmentProfilePage />);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(update).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("L'adresse est obligatoire.", "error");
  });

  it("avec une adresse saisie, l'adresse est envoyée telle quelle", async () => {
    update.mockResolvedValue({ school });
    const { container } = render(<EstablishmentProfilePage />);
    fireEvent.change(screen.getByLabelText(/^Adresse/), { target: { value: "  Rohero, avenue 3  " } });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1]).toMatchObject({ address: "Rohero, avenue 3" });
  });
});
