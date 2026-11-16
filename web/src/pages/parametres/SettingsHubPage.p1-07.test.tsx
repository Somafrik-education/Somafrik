import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { COUNTRY_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "../../lib/orgHierarchy";

const roleState = vi.hoisted(() => ({ role: "Super Administrateur Somafrik" }));

vi.mock("../../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({
    user: { role: roleState.role },
  }),
}));

import { SettingsHubPage } from "./SettingsHubPage";

describe("P1-07 SettingsHub — Export masqué pour Superadmin / Admin Pays", () => {
  it("Superadmin conserve les cartes plateforme, sans Données et sauvegarde", () => {
    roleState.role = SUPER_ADMIN_ROLE;
    render(
      <MemoryRouter>
        <SettingsHubPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Politique d'abonnement par pays" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Données et sauvegarde" })).not.toBeInTheDocument();
  });

  it("Admin Pays conserve l'abonnement pays, sans Export", () => {
    roleState.role = COUNTRY_ADMIN_ROLE;
    render(
      <MemoryRouter>
        <SettingsHubPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Politique d'abonnement par pays" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Données et sauvegarde" })).not.toBeInTheDocument();
  });
});
