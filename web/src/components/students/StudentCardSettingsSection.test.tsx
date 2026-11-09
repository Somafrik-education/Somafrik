import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PermissionContext } from "../../lib/permissions";

const { getSettings, patchSettings, getCatalog, permissionCtx } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  patchSettings: vi.fn(),
  getCatalog: vi.fn(),
  permissionCtx: {
    current: {
      user: {
        id: "u-1",
        role: "Secrétaire",
        identifier: "sec@test.local",
        permissions: ["Paramètres Établissement:UPDATE"],
        schoolCode: "CD-1",
      },
      rolePermissions: {},
    } as PermissionContext,
  },
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useOptionalActiveSchool: () => ({
    activeSchoolCode: "CD-1",
    activeSchool: { code: "CD-1", name: "Lycée Test" },
  }),
}));

vi.mock("../../lib/usePermissionContext", () => ({
  usePermissionContext: () => permissionCtx.current,
}));

vi.mock("../../lib/schoolSettingsApi", () => ({
  schoolSettingsApi: {
    get: (...args: unknown[]) => getSettings(...args),
    patch: (...args: unknown[]) => patchSettings(...args),
  },
}));

vi.mock("../../lib/educationReferenceApi", () => ({
  educationReferenceApi: {
    getSchoolCatalog: (...args: unknown[]) => getCatalog(...args),
  },
}));

import { StudentCardSettingsSection } from "./StudentCardSettingsSection";

const base = {
  schoolCode: "CD-1",
  periodMode: "trimestre",
  defaultScale: 20,
  reportCardMode: "period",
};

describe("StudentCardSettingsSection", () => {
  beforeEach(() => {
    getSettings.mockReset();
    patchSettings.mockReset();
    getCatalog.mockReset();
    getCatalog.mockResolvedValue({ schoolCode: "CD-1", countryCode: "CD", levels: [], streams: [], groups: [] });
    permissionCtx.current = {
      user: {
        id: "u-1",
        role: "Secrétaire",
        identifier: "sec@test.local",
        permissions: ["Paramètres Établissement:UPDATE"],
        schoolCode: "CD-1",
      } as PermissionContext["user"],
      rolePermissions: {},
    };
  });

  it("neutralise les sous-options quand le master est inactif", async () => {
    getSettings.mockResolvedValue({ ...base, studentCardEnabled: false, studentCardQrEnabled: true });
    render(<StudentCardSettingsSection />);
    expect(await screen.findByRole("checkbox", { name: "QR" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "NFC" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Pointage présence" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Contrôle financier informatif" })).toBeDisabled();
    expect(screen.getByText(/ne bloque pas la prise de présence/i)).toBeInTheDocument();
  });

  it("reste fail-closed si la lecture des paramètres échoue", async () => {
    getSettings.mockRejectedValue(new Error("réseau"));
    render(<StudentCardSettingsSection />);
    expect(await screen.findByText(/n’ont pas pu être lus/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enregistrer la carte élève" })).toBeNull();
  });

  it("propose QR et NFC ensemble quand le master est actif", async () => {
    getSettings.mockResolvedValue({
      ...base,
      studentCardEnabled: true,
      studentCardQrEnabled: true,
      studentCardNfcEnabled: true,
    });
    render(<StudentCardSettingsSection />);
    expect(await screen.findByRole("checkbox", { name: "QR" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "NFC" })).toBeChecked();
    expect(screen.getByText(/ne programme pas la puce NFC/i)).toBeInTheDocument();
  });

  describe("CARTE-CYCLE-01 — titulaire de la carte", () => {
    const LEVEL_SUP = "22222222-2222-4222-8222-222222222222";
    const LEVEL_SEC = "11111111-1111-4111-8111-111111111111";
    const LEVEL_OFF = "33333333-3333-4333-8333-333333333333";

    it("type non déterminant : avertit et enregistre le choix explicite « Étudiant »", async () => {
      const user = userEvent.setup();
      getSettings.mockResolvedValue({ ...base, studentCardEnabled: true, studentCardHolderKind: null, studentCardHolderFromSchoolType: null });
      patchSettings.mockImplementation(async (payload: Record<string, unknown>) => ({ ...base, ...payload }));
      render(<StudentCardSettingsSection />);
      const select = await screen.findByLabelText("Pour tout l’établissement");
      expect(screen.getByRole("option", { name: /type d’établissement non déterminant/ })).toBeInTheDocument();
      expect(screen.getByText(/Titulaire non déterminé/)).toBeInTheDocument();
      await user.selectOptions(select, "etudiant");
      await user.click(screen.getByRole("button", { name: "Enregistrer la carte élève" }));
      await waitFor(() => expect(patchSettings).toHaveBeenCalled());
      expect(patchSettings.mock.calls[0][0]).toMatchObject({ studentCardHolderKind: "etudiant", studentCardHolderLevels: {} });
      expect(patchSettings.mock.calls[0][1]).toBe("CD-1");
    });

    it("type déterminant : l'option automatique affiche le titulaire déduit, sans avertissement", async () => {
      getSettings.mockResolvedValue({ ...base, studentCardEnabled: true, studentCardHolderKind: null, studentCardHolderFromSchoolType: "eleve" });
      render(<StudentCardSettingsSection />);
      expect(await screen.findByRole("option", { name: "Automatique selon le type d’établissement : Élève" })).toBeInTheDocument();
      expect(screen.queryByText(/Titulaire non déterminé/)).toBeNull();
    });

    it("établissement mixte : surcharge par niveau actif uniquement, retour « Comme l'établissement »", async () => {
      const user = userEvent.setup();
      getCatalog.mockResolvedValue({
        schoolCode: "CD-1", countryCode: "CD", streams: [], groups: [],
        levels: [
          { id: LEVEL_SUP, countryCode: "CD", code: "SUP", name: "Supérieur", displayOrder: 2, status: "active", schoolActive: true },
          { id: LEVEL_SEC, countryCode: "CD", code: "SEC", name: "Secondaire", displayOrder: 1, status: "active", schoolActive: true },
          { id: LEVEL_OFF, countryCode: "CD", code: "OFF", name: "Inactif", displayOrder: 3, status: "active", schoolActive: false },
        ],
      });
      getSettings.mockResolvedValue({
        ...base, studentCardEnabled: true, studentCardHolderKind: "eleve", studentCardHolderFromSchoolType: null,
        studentCardHolderLevels: { [LEVEL_SEC]: "eleve" },
      });
      patchSettings.mockImplementation(async (payload: Record<string, unknown>) => ({ ...base, ...payload }));
      render(<StudentCardSettingsSection />);
      await user.selectOptions(await screen.findByLabelText("Supérieur"), "etudiant");
      await user.selectOptions(screen.getByLabelText("Secondaire"), "");
      expect(screen.queryByLabelText("Inactif")).toBeNull();
      expect(screen.getByText(/l’émission reste bloquée pour un élève sans classe courante/)).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Enregistrer la carte élève" }));
      await waitFor(() => expect(patchSettings).toHaveBeenCalled());
      expect(patchSettings.mock.calls[0][0]).toMatchObject({
        studentCardHolderKind: "eleve",
        studentCardHolderLevels: { [LEVEL_SUP]: "etudiant" },
      });
    });

    it("niveaux illisibles : réglage par niveau indisponible et jamais écrasé à l'enregistrement", async () => {
      const user = userEvent.setup();
      getCatalog.mockRejectedValue(new Error("réseau"));
      getSettings.mockResolvedValue({ ...base, studentCardEnabled: true, studentCardHolderLevels: { [LEVEL_SUP]: "etudiant" } });
      patchSettings.mockImplementation(async (payload: Record<string, unknown>) => ({ ...base, ...payload }));
      render(<StudentCardSettingsSection />);
      expect(await screen.findByText(/réglage par niveau est indisponible/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Enregistrer la carte élève" }));
      await waitFor(() => expect(patchSettings).toHaveBeenCalled());
      expect(Object.prototype.hasOwnProperty.call(patchSettings.mock.calls[0][0], "studentCardHolderLevels")).toBe(false);
    });

    it("sans droit de modification : réglage visible mais non modifiable, aucun enregistrement", async () => {
      permissionCtx.current = {
        user: { id: "u-2", role: "Enseignant", identifier: "t@test.local", permissions: ["Paramètres Établissement:READ"], schoolCode: "CD-1" } as PermissionContext["user"],
        rolePermissions: {},
      };
      getSettings.mockResolvedValue({ ...base, studentCardEnabled: true, studentCardHolderKind: null, studentCardHolderFromSchoolType: null });
      render(<StudentCardSettingsSection />);
      expect(await screen.findByLabelText("Pour tout l’établissement")).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Enregistrer la carte élève" })).toBeNull();
    });
  });
});
