import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
const apiGet = vi.hoisted(() => vi.fn());

vi.mock("../../context/DataContext", () => ({
  useData: () => ({
    state: { students: [{ id: "1" }] },
    update: vi.fn(),
  }),
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: { role: "Super Administrateur Somafrik", permissions: ["ALL_PRIVILEGES"], schoolCode: "*" },
    },
  }),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({ activeSchoolCode: "CD-2026-0001" }),
}));

vi.mock("../../lib/entityModules", () => ({
  getScopedEntityRows: () => [{ id: "1", firstName: "Amina" }],
}));

vi.mock("../../api/client", () => ({
  api: { get: apiGet },
}));

vi.mock("../../design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../design-system")>();
  return {
    ...actual,
    useToast: () => ({ showToast: vi.fn() }),
  };
});

import { SettingsDataPage } from "./DataBackupSettingsPage";

describe("P1-07 SettingsDataPage — Superadmin n'appelle pas /data-export", () => {
  it("redirige hors de la page Export et n'appelle pas l'API", () => {
    render(
      <MemoryRouter initialEntries={["/parametres/donnees"]}>
        <Routes>
          <Route path="/parametres/donnees" element={<SettingsDataPage />} />
          <Route path="/parametres" element={<div>Hub paramètres</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Hub paramètres")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Données et sauvegarde" })).not.toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalled();
  });
});
