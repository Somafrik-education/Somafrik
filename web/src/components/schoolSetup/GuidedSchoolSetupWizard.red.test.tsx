/**
 * RED — rendu Web de l'assistant guidé (W2–W6, W8).
 * Échoue tant que GuidedSchoolSetupWizard n'existe pas.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "../../api/client";

const { completeStep, getGuided, finalize } = vi.hoisted(() => ({
  completeStep: vi.fn(),
  getGuided: vi.fn(),
  finalize: vi.fn(),
}));

vi.mock("../../lib/schoolSetupGuidedApi", () => ({
  schoolSetupGuidedApi: {
    get: (...args: unknown[]) => getGuided(...args),
    completeStep: (...args: unknown[]) => completeStep(...args),
    finalize: (...args: unknown[]) => finalize(...args),
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
    finalize.mockReset();
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

  const payload100 = {
    ...payload40,
    status: "operational" as const,
    percent: 100,
    currentStep: 10,
    lastValidStep: 10,
    nextStepKey: null,
    nextStepLabel: null,
    completedSteps: [
      "establishment",
      "academicYear",
      "structure",
      "subjects",
      "teachers",
      "students",
      "finance",
      "pedagogy",
      "communication",
      "users",
    ],
    steps: payload40.steps.map((step) => ({ ...step, done: true, unlocked: true })),
  };

  const finalized100 = {
    ...payload100,
    finalized: true,
    finalizedAt: "2026-09-21T00:00:00.000Z",
  };

  it("HOLD — à 100 % Terminer confirme le backend avant le succès", async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    finalize.mockResolvedValue(finalized100);
    const { GuidedSchoolSetupWizard } = await import("./GuidedSchoolSetupWizard");
    render(
      <MemoryRouter>
        <GuidedSchoolSetupWizard payload={payload100} onFinish={onFinish} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Étape 10 sur 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vérifier la configuration" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Terminer la configuration" }));
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(completeStep).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
    expect(await screen.findByText("Configuration de votre établissement terminée")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accéder au tableau de bord" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("HOLD — Vérifier la configuration puis Terminer reste possible à 100 %", async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    finalize.mockResolvedValue(finalized100);
    const { GuidedSchoolSetupWizard } = await import("./GuidedSchoolSetupWizard");
    render(
      <MemoryRouter>
        <GuidedSchoolSetupWizard payload={payload100} onFinish={onFinish} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Vérifier la configuration" }));
    expect(screen.getByText("Étape 1 sur 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terminer la configuration" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Terminer la configuration" }));
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(completeStep).not.toHaveBeenCalled();
    expect(await screen.findByText("Configuration de votre établissement terminée")).toBeInTheDocument();
  });

  it("une erreur API n'affiche pas la réussite", async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    finalize.mockRejectedValue(
      new ApiError("Étapes obligatoires incomplètes : Élèves.", 409, "SETUP_INCOMPLETE", {
        missingSteps: [{ key: "students", label: "Élèves" }],
      }),
    );
    const { GuidedSchoolSetupWizard } = await import("./GuidedSchoolSetupWizard");
    render(
      <MemoryRouter>
        <GuidedSchoolSetupWizard payload={payload100} onFinish={onFinish} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Terminer la configuration" }));
    expect(await screen.findByText("Étapes obligatoires à corriger : Élèves.")).toBeInTheDocument();
    expect(screen.queryByText("Configuration de votre établissement terminée")).not.toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("un double clic ne finalise qu'une fois", async () => {
    const onFinish = vi.fn();
    finalize.mockResolvedValue(finalized100);
    const { GuidedSchoolSetupWizard } = await import("./GuidedSchoolSetupWizard");
    render(
      <MemoryRouter>
        <GuidedSchoolSetupWizard payload={payload100} onFinish={onFinish} />
      </MemoryRouter>,
    );
    const button = screen.getByRole("button", { name: "Terminer la configuration" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Configuration de votre établissement terminée")).toBeInTheDocument();
  });

  it("une configuration déjà terminée n'est pas présentée comme inachevée", async () => {
    const { GuidedSchoolSetupWizard } = await import("./GuidedSchoolSetupWizard");
    render(
      <MemoryRouter>
        <GuidedSchoolSetupWizard payload={finalized100} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Configuration de votre établissement terminée")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Terminer la configuration" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accéder au tableau de bord" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ouvrir les comptes utilisateurs/ })).toBeInTheDocument();
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
