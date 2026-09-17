/**
 * LOT 1 RED — Issue #683 — entrée permanente Paramètres.
 * Échoue tant que la carte « Configuration de l'établissement » est absente.
 */

import fs from "node:fs";
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

  it("WZ-04c — une nouvelle authentification réinitialise le dismiss mémoire", async () => {
    const loginSource = fs.readFileSync(new URL("../LoginPage.tsx", import.meta.url), "utf8");
    const onSubmitStart = loginSource.indexOf("async function onSubmit");
    const onPasswordStart = loginSource.indexOf("async function onPasswordChange");
    const onPasswordEnd = loginSource.indexOf("function cancelPasswordChange", onPasswordStart);
    const onSubmitSource = loginSource.slice(
      onSubmitStart,
      onPasswordStart > onSubmitStart ? onPasswordStart : undefined,
    );
    const onPasswordSource = loginSource.slice(
      onPasswordStart,
      onPasswordEnd > onPasswordStart ? onPasswordEnd : undefined,
    );
    expect(onSubmitStart, "onSubmit introuvable dans LoginPage").toBeGreaterThanOrEqual(0);
    expect(onPasswordStart, "onPasswordChange introuvable dans LoginPage").toBeGreaterThanOrEqual(0);
    expect(
      onSubmitSource,
      "une nouvelle connexion doit réinitialiser le dismiss du wizard",
    ).toContain("resetSchoolSetupWizardSessionDismiss()");
    expect(
      onPasswordSource,
      "après changement du mot de passe, le statut canonique doit encore piloter l'ouverture du wizard",
    ).toContain("shouldAutoOpenSchoolSetupWizard");

    const {
      dismissSchoolSetupWizardForSession,
      resetSchoolSetupWizardSessionDismiss,
      shouldAutoOpenSchoolSetupWizard,
    } = await import("../../lib/schoolSetupWeb");
    const payload = {
      status: "NOT_STARTED" as const,
      core: { academicYear: false, structure: false, classes: false },
      progress: { coreDone: 0, coreTotal: 3 },
    };

    resetSchoolSetupWizardSessionDismiss();
    dismissSchoolSetupWizardForSession();
    expect(
      shouldAutoOpenSchoolSetupWizard({ payload, role: "Admin School", mustChangePassword: false }),
    ).toBe(false);

    resetSchoolSetupWizardSessionDismiss();
    expect(
      shouldAutoOpenSchoolSetupWizard({ payload, role: "Admin School", mustChangePassword: false }),
    ).toBe(true);
  });
});
