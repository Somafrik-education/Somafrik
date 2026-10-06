import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PermissionContext } from "../../lib/permissions";

const { getSettings, patchSettings, permissionCtx } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  patchSettings: vi.fn(),
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
});
