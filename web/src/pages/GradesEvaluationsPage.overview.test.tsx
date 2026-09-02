import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: false,
}));

const sessionUser = vi.hoisted(() => ({
  current: {
    id: "u-admin",
    role: "Admin School",
    schoolCode: "IN",
    schoolId: "school-in",
    schoolPublicCode: "IN",
    name: "Admin",
  } as {
    id: string;
    role: string;
    schoolCode: string;
    schoolId?: string;
    schoolPublicCode?: string;
    name?: string;
  },
}));

const dataState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

function notesState() {
  return {
    schools: [{ code: "IN", name: "IN" }],
    classes: [{ id: "uuid-2a", name: "2ème A", schoolCode: "IN" }],
    students: [
      {
        id: "STU-RIZIKI",
        name: "Riziki Test",
        firstName: "Riziki",
        lastName: "Test",
        className: "2ème A",
        schoolCode: "IN",
        schoolId: "school-in",
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
    notes: [
      {
        id: "g1",
        studentId: "STU-RIZIKI",
        studentName: "Riziki Test",
        className: "2ème A",
        subject: "Mathématiques",
        period: "Trimestre 1",
        value: 14,
        scale: 20,
        gradeStatus: "Saisie",
        evaluationCoefficient: 1,
        schoolCode: "IN",
      },
    ],
    grades: [],
    academicConfigs: {
      IN: {
        periods: [{ name: "Trimestre 1" }, { name: "Trimestre 2" }, { name: "Trimestre 3" }],
      },
    },
    rolePermissions: {},
    auditLog: [],
  };
}

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: sessionUser.current,
    },
  }),
}));

vi.mock("../context/DataContext", () => ({
  useData: () => ({
    state: dataState.current,
    loading: false,
    error: null,
    syncJournal: [],
    update: vi.fn(),
    refresh: vi.fn(),
    retryFailedSync: vi.fn(),
  }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    activeSchoolCode: sessionUser.current.schoolCode,
    scopedUser: sessionUser.current,
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({
    user: sessionUser.current,
    rolePermissions: {},
  }),
  useFeaturePermissions: () => ({ ...permissions }),
}));

vi.mock("../lib/evaluations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/evaluations")>();
  return {
    ...actual,
    buildEvaluationsFromExams: () => [],
  };
});

vi.mock("../lib/pedagogyApi", () => ({
  pedagogyApi: {
    createEvaluation: vi.fn(),
    updateEvaluation: vi.fn(),
    listEvaluations: vi.fn(),
    upsertNote: vi.fn(),
  },
}));

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

describe("GradesEvaluationsPage — Par classe / Statistiques", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
    sessionUser.current = {
      id: "u-admin",
      role: "Admin School",
      schoolCode: "IN",
      schoolId: "school-in",
      schoolPublicCode: "IN",
      name: "Admin",
    };
    dataState.current = notesState();
  });

  it("clic Par classe: ranking Riziki / 14, pas de crash, pas d'écran vide", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Par classe" }));

    expect(screen.queryByText("Aucune note pour cette période")).not.toBeInTheDocument();
    expect(screen.getByText("Classement — 2ème A")).toBeInTheDocument();
    expect(screen.getByText("Riziki Test")).toBeInTheDocument();
    expect(screen.getAllByText("14.00").length).toBeGreaterThan(0);
  });

  it("clic Statistiques: même overview ranking, pas de crash", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Statistiques" }));

    expect(screen.queryByText("Aucune note pour cette période")).not.toBeInTheDocument();
    expect(screen.getByText("Classement — 2ème A")).toBeInTheDocument();
    expect(screen.getByText("Moyenne de classe")).toBeInTheDocument();
    expect(screen.getByText("Riziki Test")).toBeInTheDocument();
    expect(screen.getAllByText("14.00").length).toBeGreaterThan(0);
  });

  it("Admin Toutes les périodes (défaut): les notes T1 restent visibles", () => {
    renderPage();

    const period = screen.getByLabelText("Période") as HTMLSelectElement;
    expect(period.value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Par classe" }));

    expect(screen.getAllByText("Toutes les périodes").length).toBeGreaterThan(0);
    expect(screen.getAllByText("14.00").length).toBeGreaterThan(0);
  });
});
