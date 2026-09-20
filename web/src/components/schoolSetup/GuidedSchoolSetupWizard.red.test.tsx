/**
 * RED — rendu Web de l'assistant guidé (W2–W6, W8).
 * Échoue tant que GuidedSchoolSetupWizard n'existe pas.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const { completeStep, getGuided } = vi.hoisted(() => ({
  completeStep: vi.fn(),
  getGuided: vi.fn(),
}));

vi.mock("../../lib/schoolSetupGuidedApi", () => ({
  schoolSetupGuidedApi: {
    get: (...args: unknown[]) => getGuided(...args),
    completeStep: (...args: unknown[]) => completeStep(...args),
  },
}));

const payload40 = {
  schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  status: "configuration_required" as const,
  percent: 40,
  currentStep: 5,
  lastValidStep: 4,
  nextStepKey: "teachers",
  nextStepLabel: "Enseignants",
  completedSteps: ["establishment", "academicYear", "structure", "subjects"],
  steps: [
    { key: "establishment", index: 1, label: "Informations établissement", done: true, unlocked: true },
    { key: "academicYear", index: 2, label: "Année scolaire", done: true, unlocked: true },
    { key: "structure", index: 3, label: "Structure pédagogique", done: true, unlocked: true },
    { key: "subjects", index: 4, label: "Matières", done: true, unlocked: true },
    { key: "teachers", index: 5, label: "Enseignants", done: false, unlocked: true },
    { key: "students", index: 6, label: "Élèves", done: false, unlocked: false },
    { key: "finance", index: 7, label: "Finance", done: false, unlocked: false },
    { key: "pedagogy", index: 8, label: "Paramètres pédagogiques", done: false, unlocked: false },
    { key: "communication", index: 9, label: "Communication", done: false, unlocked: false },
    { key: "users", index: 10, label: "Utilisateurs et droits", done: false, unlocked: false },
  ],
  updatedAt: "2026-09-20T00:00:00.000Z",
};

describe("RED — GuidedSchoolSetupWizard UX", () => {
  beforeEach(() => {
    completeStep.mockReset();
    getGuided.mockReset();
    getGuided.mockResolvedValue(payload40);
    completeStep.mockResolvedValue({
      ...payload40,
      percent: 50,
      currentStep: 6,
      lastValidStep: 5,
      completedSteps: [...payload40.completedSteps, "teachers"],
      nextStepKey: "students",
      nextStepLabel: "Élèves",
    });
  });

  it("W2/W3 — affiche le titre, l'étape courante et le pourcentage persisté", async () => {
    const { GuidedSchoolSetupWizard } = await import("./GuidedSchoolSetupWizard");
    render(
      <MemoryRouter>
        <GuidedSchoolSetupWizard payload={payload40} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Configuration de votre établissement")).toBeInTheDocument();
    expect(screen.getByText("Étape 5 sur 10")).toBeInTheDocument();
    expect(screen.getByText("Configuration 40 % terminée")).toBeInTheDocument();
  });

  it("W4 — Enregistrer et continuer appelle completeStep puis avance", async () => {
    const user = userEvent.setup();
    const { GuidedSchoolSetupWizard } = await import("./GuidedSchoolSetupWizard");
    render(
      <MemoryRouter>
        <GuidedSchoolSetupWizard payload={payload40} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Enregistrer et continuer" }));
    expect(completeStep).toHaveBeenCalledWith("teachers");
    expect(await screen.findByText("Étape 6 sur 10")).toBeInTheDocument();
    expect(screen.getByText("Configuration 50 % terminée")).toBeInTheDocument();
  });

  it("W5 — Précédent revient à une étape terminée sans appeler un reset", async () => {
    const user = userEvent.setup();
    const { GuidedSchoolSetupWizard } = await import("./GuidedSchoolSetupWizard");
    render(
      <MemoryRouter>
        <GuidedSchoolSetupWizard payload={payload40} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Précédent" }));
    expect(completeStep).not.toHaveBeenCalled();
    expect(screen.getByText("Étape 4 sur 10")).toBeInTheDocument();
    expect(screen.getByText("Configuration 40 % terminée")).toBeInTheDocument();
  });

  it("W6 — Quitter et reprendre plus tard appelle onLeave sans reset API", async () => {
    const user = userEvent.setup();
    const onLeave = vi.fn();
    const { GuidedSchoolSetupWizard } = await import("./GuidedSchoolSetupWizard");
    render(
      <MemoryRouter>
        <GuidedSchoolSetupWizard payload={payload40} onLeave={onLeave} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Quitter et reprendre plus tard" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(completeStep).not.toHaveBeenCalled();
  });

  it("W8 — reprend à l'étape courante fournie par le serveur", async () => {
    const { GuidedSchoolSetupWizard } = await import("./GuidedSchoolSetupWizard");
    render(
      <MemoryRouter>
        <GuidedSchoolSetupWizard payload={payload40} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Enseignants" })).toBeInTheDocument();
    expect(screen.getByText("Étape 5 sur 10")).toBeInTheDocument();
  });
});
