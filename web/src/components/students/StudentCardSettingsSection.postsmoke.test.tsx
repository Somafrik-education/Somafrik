import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "../../api/client";
import type { PermissionContext } from "../../lib/permissions";

/**
 * PROD-V25-POSTSMOKE-01 — anomalie A : « Enregistrement refusé » générique sur la carte élève.
 * Le refus serveur doit être explicite (HTTP + code), et le verrou NFC de production préservé.
 */
const { getSettings, patchSettings, getCatalog, permissionCtx } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  patchSettings: vi.fn(),
  getCatalog: vi.fn(),
  permissionCtx: { current: null as unknown as PermissionContext },
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useOptionalActiveSchool: () => ({ activeSchoolCode: "CD-1", activeSchool: { code: "CD-1", name: "Lycée Test" } }),
}));
vi.mock("../../lib/usePermissionContext", () => ({ usePermissionContext: () => permissionCtx.current }));
vi.mock("../../lib/schoolSettingsApi", () => ({
  schoolSettingsApi: {
    get: (...args: unknown[]) => getSettings(...args),
    patch: (...args: unknown[]) => patchSettings(...args),
  },
}));
vi.mock("../../lib/educationReferenceApi", () => ({
  educationReferenceApi: { getSchoolCatalog: (...args: unknown[]) => getCatalog(...args) },
}));

import { StudentCardSettingsSection } from "./StudentCardSettingsSection";
import { studentCardSaveErrorMessage } from "../../lib/studentCardSettingsErrors";

const base = { schoolCode: "CD-1", periodMode: "trimestre", defaultScale: 20, reportCardMode: "period" };
const NFC_REFUSAL = new ApiError(
  "L'encodage NFC des cartes élèves n'est pas encore disponible sur cette plateforme.",
  409,
  "STUDENT_CARD_NFC_NOT_HOMOLOGATED",
  { key: "studentCardNfcEnabled" },
);

describe("PROD-V25-POSTSMOKE-01 — carte élève : refus explicite et verrou NFC", () => {
  beforeEach(() => {
    getSettings.mockReset();
    patchSettings.mockReset();
    getCatalog.mockReset();
    getCatalog.mockResolvedValue({ schoolCode: "CD-1", countryCode: "CD", levels: [], streams: [], groups: [] });
    permissionCtx.current = {
      user: {
        id: "u-1",
        role: "Directeur",
        identifier: "dir@test.local",
        permissions: ["Paramètres Établissement:UPDATE"],
        schoolCode: "CD-1",
      } as PermissionContext["user"],
      rolePermissions: {},
    };
  });

  it("NFC activé : le refus 409 du verrou est expliqué, le NFC est décoché et désactivé", async () => {
    const user = userEvent.setup();
    getSettings.mockResolvedValue({ ...base, studentCardEnabled: true, studentCardQrEnabled: true, studentCardNfcEnabled: false });
    patchSettings.mockRejectedValueOnce(NFC_REFUSAL);
    render(<StudentCardSettingsSection />);
    await user.click(await screen.findByRole("checkbox", { name: "NFC" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer la carte élève" }));
    expect(await screen.findByText(/n’est pas encore homologué/)).toBeInTheDocument();
    expect(screen.queryByText(/^Enregistrement refusé\.$/)).toBeNull();
    const nfc = screen.getByRole("checkbox", { name: /^NFC/ });
    expect(nfc).not.toBeChecked();
    expect(nfc).toBeDisabled();
    expect(patchSettings.mock.calls[0][0]).toMatchObject({ studentCardNfcEnabled: true });
  });

  it("après le refus NFC, un nouvel enregistrement passe sans NFC (QR conservé)", async () => {
    const user = userEvent.setup();
    getSettings.mockResolvedValue({ ...base, studentCardEnabled: true, studentCardQrEnabled: true, studentCardNfcEnabled: false });
    patchSettings
      .mockRejectedValueOnce(NFC_REFUSAL)
      .mockImplementationOnce(async (payload: Record<string, unknown>) => ({ ...base, ...payload }));
    render(<StudentCardSettingsSection />);
    await user.click(await screen.findByRole("checkbox", { name: "NFC" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer la carte élève" }));
    await screen.findByText(/n’est pas encore homologué/);
    await user.click(screen.getByRole("button", { name: "Enregistrer la carte élève" }));
    await waitFor(() => expect(patchSettings).toHaveBeenCalledTimes(2));
    expect(patchSettings.mock.calls[1][0]).toMatchObject({ studentCardNfcEnabled: false, studentCardQrEnabled: true });
    expect(await screen.findByText(/Paramètres de carte enregistrés/)).toBeInTheDocument();
  });

  it("NFC désactivé : un autre refus affiche le motif serveur, le statut HTTP et le code", async () => {
    const user = userEvent.setup();
    getSettings.mockResolvedValue({ ...base, studentCardEnabled: true, studentCardQrEnabled: true });
    patchSettings.mockRejectedValueOnce(
      new ApiError("Niveau d'enseignement non activé pour cet établissement.", 400, "INVALID_STUDENT_CARD_HOLDER_LEVEL"),
    );
    render(<StudentCardSettingsSection />);
    await user.click(await screen.findByRole("button", { name: "Enregistrer la carte élève" }));
    expect(
      await screen.findByText(
        "Enregistrement refusé : Niveau d'enseignement non activé pour cet établissement. (HTTP 400, INVALID_STUDENT_CARD_HOLDER_LEVEL).",
      ),
    ).toBeInTheDocument();
    expect(patchSettings.mock.calls[0][0]).toMatchObject({ studentCardNfcEnabled: false });
  });

  it("messages : droits (403) et serveur injoignable", () => {
    expect(studentCardSaveErrorMessage(new ApiError("Accès refusé", 403, "FORBIDDEN"))).toMatch(/droits insuffisants.*HTTP 403, FORBIDDEN/);
    expect(studentCardSaveErrorMessage(new Error("réseau"))).toMatch(/serveur injoignable/);
    expect(studentCardSaveErrorMessage(new ApiError("", 500))).toMatch(/motif non précisé par le serveur \(HTTP 500\)/);
  });
});
