import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * PROD-V25-POSTSMOKE-01 — anomalie B : l'étape guidée « Communication » exige au moins une règle
 * de notification enregistrée. Sans interrupteur modifié, les règles par défaut n'étaient jamais
 * enregistrées : aucune reprise possible. L'écran doit le signaler et permettre l'enregistrement.
 */
const { getSettings, patchSettings, canEdit } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  patchSettings: vi.fn(),
  canEdit: { value: true },
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({ activeSchool: { code: "SCH-001", name: "Lycée Test" } }),
}));
vi.mock("../../lib/usePermissionContext", () => ({ usePermissionContext: () => ({ user: { role: "Admin School" } }) }));
vi.mock("../../lib/permissions", () => ({ canManageEstablishmentSettings: () => canEdit.value }));
vi.mock("../../lib/schoolNotificationSettingsApi", async () => {
  const actual = await vi.importActual<typeof import("../../lib/schoolNotificationSettingsApi")>(
    "../../lib/schoolNotificationSettingsApi",
  );
  return {
    patchFromDisplayedRules: actual.patchFromDisplayedRules,
    getSchoolNotificationSettings: (...args: unknown[]) => getSettings(...args),
    patchSchoolNotificationSettings: (...args: unknown[]) => patchSettings(...args),
  };
});

import { SettingsNotificationsPage } from "./SettingsNotificationsPage";
import { patchFromDisplayedRules } from "../../lib/schoolNotificationSettingsApi";

const EVENTS = {
  STUDENT_ABSENT: { allowedRecipients: ["PARENT"], PARENT: { IN_APP: true, PUSH: false, EMAIL: true } },
  GRADE_PUBLISHED: {
    allowedRecipients: ["PARENT", "STUDENT"],
    PARENT: { IN_APP: true, PUSH: true, EMAIL: false },
    STUDENT: { IN_APP: true, PUSH: true, EMAIL: true },
  },
};

describe("PROD-V25-POSTSMOKE-01 — notifications : règles par défaut à enregistrer", () => {
  beforeEach(() => {
    getSettings.mockReset();
    patchSettings.mockReset();
    canEdit.value = true;
  });

  it("règles non enregistrées : le motif est affiché et « Enregistrer ces règles » envoie les règles affichées", async () => {
    const user = userEvent.setup();
    getSettings.mockResolvedValue({ schoolCode: "SCH-001", events: EVENTS, configured: false });
    patchSettings.mockResolvedValue({ schoolCode: "SCH-001", events: EVENTS, configured: true });
    render(<SettingsNotificationsPage />);
    expect(await screen.findByText("Règles par défaut non enregistrées")).toBeInTheDocument();
    expect(screen.getByText(/exige au moins une règle enregistrée/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enregistrer ces règles" }));
    await waitFor(() => expect(patchSettings).toHaveBeenCalledTimes(1));
    expect(patchSettings).toHaveBeenCalledWith("SCH-001", {
      events: {
        STUDENT_ABSENT: { PARENT: { IN_APP: true, PUSH: false, EMAIL: true } },
        GRADE_PUBLISHED: {
          PARENT: { IN_APP: true, PUSH: true, EMAIL: false },
          STUDENT: { IN_APP: true, PUSH: true, EMAIL: true },
        },
      },
    });
    await waitFor(() => expect(screen.queryByText("Règles par défaut non enregistrées")).toBeNull());
  });

  it("règles déjà enregistrées : aucune alerte ni bouton", async () => {
    getSettings.mockResolvedValue({ schoolCode: "SCH-001", events: EVENTS, configured: true });
    render(<SettingsNotificationsPage />);
    await screen.findByText("Absence d'un élève");
    expect(screen.queryByText("Règles par défaut non enregistrées")).toBeNull();
    expect(screen.queryByRole("button", { name: "Enregistrer ces règles" })).toBeNull();
  });

  it("lecture seule (sans droit de modification) : alerte visible, pas de bouton d'enregistrement", async () => {
    canEdit.value = false;
    getSettings.mockResolvedValue({ schoolCode: "SCH-001", events: EVENTS, configured: false });
    render(<SettingsNotificationsPage />);
    expect(await screen.findByText("Règles par défaut non enregistrées")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enregistrer ces règles" })).toBeNull();
  });

  it("refus serveur : message affiché, alerte conservée", async () => {
    const user = userEvent.setup();
    getSettings.mockResolvedValue({ schoolCode: "SCH-001", events: EVENTS, configured: false });
    patchSettings.mockRejectedValue(new Error("Accès refusé aux paramètres d'établissement."));
    render(<SettingsNotificationsPage />);
    await user.click(await screen.findByRole("button", { name: "Enregistrer ces règles" }));
    expect(await screen.findByText("Accès refusé aux paramètres d'établissement.")).toBeInTheDocument();
    expect(screen.getByText("Règles par défaut non enregistrées")).toBeInTheDocument();
  });

  it("patchFromDisplayedRules ne vise que les destinataires autorisés", () => {
    const patch = patchFromDisplayedRules({ schoolCode: "SCH-001", events: EVENTS } as never);
    expect(Object.keys(patch.events.GRADE_PUBLISHED ?? {})).toEqual(["PARENT", "STUDENT"]);
    expect(patch.events.STUDENT_ABSENT).toEqual({ PARENT: { IN_APP: true, PUSH: false, EMAIL: true } });
  });
});
