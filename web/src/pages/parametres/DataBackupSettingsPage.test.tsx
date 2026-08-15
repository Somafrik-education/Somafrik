import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { showToast, apiGet } = vi.hoisted(() => ({
  showToast: vi.fn(),
  apiGet: vi.fn(),
}));

vi.mock("../../context/DataContext", () => ({
  useData: () => ({
    state: { students: [{ id: "1" }], teachers: [], classes: [], courses: [], assignments: [], payments: [], notes: [], presences: [], bulletins: [], documents: [] },
    update: vi.fn(),
  }),
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    session: { user: { role: "Admin School", schoolCode: "CD-2026-0001", identifier: "admin" } },
  }),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({ activeSchoolCode: "CD-2026-0001" }),
}));

vi.mock("../../lib/entityModules", () => ({
  getScopedEntityRows: (key: string) => (key === "students" ? [{ id: "1", firstName: "Amina" }] : []),
}));

vi.mock("../../api/client", () => ({
  api: { get: apiGet },
}));

vi.mock("../../design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../design-system")>();
  return {
    ...actual,
    useToast: () => ({ showToast }),
  };
});

import { SettingsDataPage } from "./DataBackupSettingsPage";

describe("SettingsDataPage LOT 6 — export sans restauration", () => {
  beforeEach(() => {
    showToast.mockReset();
    apiGet.mockReset();
    apiGet.mockResolvedValue({
      format: "somafrik-export",
      version: 1,
      schoolCode: "CD-2026-0001",
      includedDomains: ["students"],
      domains: { students: [] },
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  it("affiche l'export et le message de restauration indisponible, sans bouton Restaurer", () => {
    render(<SettingsDataPage />);
    expect(screen.getByRole("heading", { name: "Données et sauvegarde" })).toBeInTheDocument();
    expect(screen.getAllByText(/Sauvegarde\/export disponible/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Restauration complète indisponible/i)).toBeInTheDocument();
    expect(screen.getAllByText(/La restauration complète n.est pas disponible/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Télécharger l'export/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Restaurer/i })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("déclenche GET /api/data-export et ne propose pas de restore", async () => {
    const user = userEvent.setup();
    render(<SettingsDataPage />);
    await user.click(screen.getByRole("button", { name: /Télécharger l'export/i }));
    expect(apiGet).toHaveBeenCalledWith("/data-export?schoolCode=CD-2026-0001");
    expect(showToast).toHaveBeenCalledWith("Export JSON versionné téléchargé.", "success");
  });
});
