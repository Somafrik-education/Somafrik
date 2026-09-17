/**
 * LOT 4 — section Complétude recommandée sur l'écran permanent Web.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { getStatus } = vi.hoisted(() => ({ getStatus: vi.fn() }));

vi.mock("../../lib/schoolSetupStatusApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/schoolSetupStatusApi")>();
  return {
    ...actual,
    schoolSetupStatusApi: {
      get: (...args: unknown[]) => getStatus(...args),
    },
  };
});

import { SchoolSetupSettingsPage } from "./SchoolSetupSettingsPage";

const readyMixedOptional = {
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

describe("LOT 4 — SchoolSetupSettingsPage complétude recommandée", () => {
  beforeEach(() => {
    getStatus.mockReset();
    getStatus.mockResolvedValue(readyMixedOptional);
  });

  it("affiche les 5 indicateurs depuis payload.optional sans subjects ni mélange 3/3", async () => {
    render(
      <MemoryRouter>
        <SchoolSetupSettingsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Complétude recommandée")).toBeInTheDocument();
    expect(screen.getByText(/Progression : 3 \/ 3/)).toBeInTheDocument();
    expect(screen.getByText("Périodes scolaires")).toBeInTheDocument();
    expect(screen.getByText("Enseignants")).toBeInTheDocument();
    expect(screen.getByText("Élèves")).toBeInTheDocument();
    expect(screen.getByText("Grilles tarifaires")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getAllByText("Configuré")).toHaveLength(2);
    expect(screen.getAllByText("À compléter")).toHaveLength(3);
    expect(screen.queryByText(/Matières/i)).toBeNull();
    expect(screen.queryByText("subjects")).toBeNull();
  });
});
