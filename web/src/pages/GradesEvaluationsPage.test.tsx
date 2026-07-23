import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: false,
}));

const dataState = vi.hoisted(() => ({
  current: {
    schools: [{ code: "SCH-001", name: "Lycée Test" }],
    classes: [{ id: "c1", name: "6e A", schoolCode: "SCH-001" }],
    students: [
      {
        id: "s1",
        name: "Diallo Awa",
        className: "6e A",
        schoolCode: "SCH-001",
      },
    ],
    teachers: [],
    assignments: [],
    courses: [],
    contacts: [],
    relations: [],
    users: [],
    exams: [],
    evaluations: [],
    grades: [],
    academicConfigBySchool: {
      "SCH-001": { periods: [{ id: "p1", label: "T1" }], activePeriodId: "p1" },
    },
    rolePermissions: {},
    auditLog: [],
  } as Record<string, unknown>,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "u1",
        role: "Admin School",
        schoolCode: "SCH-001",
        name: "Admin",
      },
    },
  }),
}));

vi.mock("../context/DataContext", () => ({
  useData: () => ({
    state: dataState.current,
    loading: false,
    error: null,
    update: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    activeSchoolCode: "SCH-001",
    scopedUser: {
      id: "u1",
      role: "Admin School",
      schoolCode: "SCH-001",
      name: "Admin",
    },
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({
    user: { role: "Admin School", schoolCode: "SCH-001" },
    rolePermissions: {},
  }),
  useFeaturePermissions: () => ({ ...permissions }),
}));

vi.mock("../lib/evaluations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/evaluations")>();
  return {
    ...actual,
    buildEvaluationsFromExams: () => [],
    ensureEvaluationsSynced: (_state: unknown, _code: string) => [],
    scopedEvaluations: () => [],
    scopedGrades: () => [],
    allGrades: () => [],
    resolveGradesPeriod: () => "T1",
  };
});

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../components/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));

vi.mock("../components/ui/PrintButton", () => ({
  PrintButton: () => <button type="button">Imprimer</button>,
}));

vi.mock("../components/grades/EvaluationFormModal", () => ({
  EvaluationFormModal: () => null,
}));

vi.mock("../components/grades/GradeEntryGrid", () => ({
  GradeEntryGrid: () => <div>GradeEntryGrid mock</div>,
}));

vi.mock("../components/grades/ClassGradesOverview", () => ({
  ClassGradesOverview: () => <div>ClassGradesOverview mock</div>,
}));

vi.mock("../components/grades/StudentGradesPanel", () => ({
  StudentGradesPanel: () => <div>StudentGradesPanel mock</div>,
}));

import { GradesEvaluationsPage } from "./GradesEvaluationsPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <GradesEvaluationsPage />
    </MemoryRouter>,
  );
}

describe("GradesEvaluationsPage (D3.6c ToolLayout)", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
  });

  it("structure la page Notes avec ToolLayout (Header / Context / Content)", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Notes & évaluations" })).toBeInTheDocument();
    expect(screen.getByLabelText("Contexte opérationnel")).toBeInTheDocument();
    expect(screen.getByLabelText("Zone de travail")).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Vues Notes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Évaluations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saisie des notes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exporter CSV" })).toBeInTheDocument();
  });

  it("affiche ForbiddenState sans permission Notes:read", () => {
    permissions.canRead = false;
    renderPage();

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Accès aux notes non autorisé");
    expect(status).toHaveTextContent(
      "Votre rôle ne permet pas d'ouvrir l'outil Notes & évaluations.",
    );
    expect(screen.queryByRole("heading", { name: "Notes & évaluations" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Contexte opérationnel")).not.toBeInTheDocument();
  });
});
