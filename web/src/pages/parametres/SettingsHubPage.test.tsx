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

describe("SettingsHubPage (D2.5)", () => {
  it("renders hub cards inside DashboardLayout content", () => {
    render(
      <MemoryRouter>
        <SettingsHubPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Profil établissement" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Année scolaire" })).toBeInTheDocument();
    expect(screen.getByLabelText("Contenu")).toBeInTheDocument();
  });
});
