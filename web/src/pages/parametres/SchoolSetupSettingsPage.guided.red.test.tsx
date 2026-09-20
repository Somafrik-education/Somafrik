/**
 * HOLD — un seul assistant sur la page configuration + Terminer → dashboard.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const { getStatus, getGuided, completeStep } = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getGuided: vi.fn(),
  completeStep: vi.fn(),
}));

vi.mock("../../lib/schoolSetupStatusApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/schoolSetupStatusApi")>();
  return {
    ...actual,
    schoolSetupStatusApi: {
      get: (...args: unknown[]) => getStatus(...args),
    },
  };
});

vi.mock("../../lib/schoolSetupGuidedApi", () => ({
  schoolSetupGuidedApi: {
    get: (...args: unknown[]) => getGuided(...args),
    completeStep: (...args: unknown[]) => completeStep(...args),
  },
}));

import { SchoolSetupSettingsPage } from "./SchoolSetupSettingsPage";

const guided40 = {
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

const guided100 = {
  ...guided40,
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
  steps: guided40.steps.map((step) => ({ ...step, done: true, unlocked: true })),
};

const lot1Payload = {
  status: "READY" as const,
  core: { academicYear: true, structure: true, classes: true },
  optional: {
    periods: true,
    subjects: false,
    teachers: false,
    students: true,
    feeGrids: false,
    notifications: false,
  },
  progress: { coreDone: 3, coreTotal: 3 },
};

describe("HOLD — SchoolSetupSettingsPage wizard exclusif", () => {
  beforeEach(() => {
    getStatus.mockReset();
    getGuided.mockReset();
    completeStep.mockReset();
    getStatus.mockResolvedValue(lot1Payload);
    getGuided.mockResolvedValue(guided40);
  });

  it("n'affiche pas l'ancien assistant quand le guidé est disponible", async () => {
    render(
      <MemoryRouter>
        <SchoolSetupSettingsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Configuration de votre établissement")).toBeInTheDocument();
    expect(screen.getByText("Étape 5 sur 10")).toBeInTheDocument();
    expect(screen.queryByText("Ces actions ouvrent les écrans existants")).not.toBeInTheDocument();
    expect(screen.queryByText("Assistant de configuration")).not.toBeInTheDocument();
    expect(screen.getByText(/Progression : 3 \/ 3/)).toBeInTheDocument();
  });

  it("à 100 % Terminer la configuration renvoie au Tableau de bord", async () => {
    const user = userEvent.setup();
    getGuided.mockResolvedValue(guided100);
    render(
      <MemoryRouter initialEntries={["/parametres/configuration-etablissement"]}>
        <Routes>
          <Route path="/parametres/configuration-etablissement" element={<SchoolSetupSettingsPage />} />
          <Route path="/tableau-de-bord" element={<h1>Tableau de bord</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Étape 10 sur 10")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Terminer la configuration" }));
    expect(await screen.findByRole("heading", { name: "Tableau de bord" })).toBeInTheDocument();
    expect(completeStep).not.toHaveBeenCalled();
  });

  it("à 100 % Vérifier puis Terminer renvoie encore au Tableau de bord", async () => {
    const user = userEvent.setup();
    getGuided.mockResolvedValue(guided100);
    render(
      <MemoryRouter initialEntries={["/parametres/configuration-etablissement"]}>
        <Routes>
          <Route path="/parametres/configuration-etablissement" element={<SchoolSetupSettingsPage />} />
          <Route path="/tableau-de-bord" element={<h1>Tableau de bord</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Étape 10 sur 10")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Vérifier la configuration" }));
    expect(screen.getByText("Étape 1 sur 10")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Terminer la configuration" }));
    expect(await screen.findByRole("heading", { name: "Tableau de bord" })).toBeInTheDocument();
    expect(completeStep).not.toHaveBeenCalled();
  });
});
