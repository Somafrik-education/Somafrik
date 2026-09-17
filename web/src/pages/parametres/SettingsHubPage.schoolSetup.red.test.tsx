/**
 * LOT 1 RED — Issue #683 — entrée permanente Paramètres.
 * Échoue tant que la carte « Configuration de l'établissement » est absente.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({
    user: { role: "Admin School" },
  }),
}));

vi.mock("../../lib/permissions", () => ({
  canReadView: () => true,
}));

vi.mock("../../lib/orgHierarchy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/orgHierarchy")>();
  return {
    ...actual,
    isSuperAdminRole: () => false,
  };
});

import { SettingsHubPage } from "./SettingsHubPage";

describe("LOT 1 RED — SettingsHub Configuration de l'établissement", () => {
  it("expose la carte permanente Configuration de l'établissement", () => {
    render(
      <MemoryRouter>
        <SettingsHubPage />
      </MemoryRouter>,
    );
    const heading = screen.queryByRole("heading", { name: "Configuration de l'établissement" });
    expect(heading, "carte Paramètres « Configuration de l'établissement » absente").not.toBeNull();
    const link = screen.queryByRole("link", { name: /Configuration de l'établissement/i });
    expect(link, "lien Paramètres configuration-etablissement absent").not.toBeNull();
    expect(link).toHaveAttribute("href", "/parametres/configuration-etablissement");
  });
});
