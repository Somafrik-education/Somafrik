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
  current: {} as Record<string, unknown>,
}));

const dataState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

const gradesForPage = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));
const evaluationsForPage = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ session: { user: sessionUser.current } }),
}));

vi.mock("../context/DataContext", () => ({
  useData: () => ({
    state: dataState.current,
    loading: false,
    error: null,
    syncJournal: [],
    update: vi.fn(),
    refresh: vi.fn(async () => undefined),
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
  usePermissionContext: () => ({ user: sessionUser.current, rolePermissions: {} }),
  useFeaturePermissions: () => ({ ...permissions }),
}));

vi.mock("../lib/evaluations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/evaluations")>();
  return {
    ...actual,
    buildEvaluationsFromExams: () => [],
    ensureEvaluationsSynced: () => evaluationsForPage.current,
    scopedEvaluations: () => evaluationsForPage.current as never[],
    scopedGrades: () => gradesForPage.current as never[],
    allGrades: () => gradesForPage.current as never[],
    resolveGradesPeriod: () => "Trimestre 1",
    canEditEvaluation: () => true,
    buildGradeBook: () => ({
      getStudentAverage: () => ({
        average: 14.5,
        rank: 3,
        rankLabel: "3e / 28",
        appreciation: "Très Bien",
        subjects: [{ subject: "Mathématiques" }, { subject: "Français" }],
      }),
    }),
  };
});

vi.mock("../lib/pedagogyApi", () => ({
  pedagogyApi: { createEvaluation: vi.fn(), updateEvaluation: vi.fn(), listEvaluations: vi.fn(), upsertNote: vi.fn() },
}));
vi.mock("../components/ui/Toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../components/ui/ConfirmDialog", () => ({ useConfirm: () => ({ confirm: vi.fn(async () => true) }) }));
vi.mock("../components/ui/PrintButton", () => ({ PrintButton: () => <button type="button">Imprimer</button> }));
vi.mock("../components/grades/EvaluationFormModal", () => ({ EvaluationFormModal: () => null }));
vi.mock("../components/grades/GradeEntryGrid", () => ({ GradeEntryGrid: () => <div>GradeEntryGrid mock</div> }));
vi.mock("../components/grades/ClassGradesOverview", () => ({
  ClassGradesOverview: () => <div>ClassGradesOverview mock</div>,
}));

import { GradesEvaluationsPage } from "./GradesEvaluationsPage";

const CHILD_A = {
  id: "stu-a",
  name: "Maeve Okito",
  firstName: "Maeve",
  lastName: "Okito",
  className: "1ère A",
  schoolCode: "SCH-001",
  schoolId: "school-sch-001",
  matricule: "CD-IN-EL-26-001",
};
const CHILD_A2 = {
  id: "stu-a2",
  name: "Lina Okito",
  firstName: "Lina",
  lastName: "Okito",
  className: "3ème B",
  schoolCode: "SCH-001",
  schoolId: "school-sch-001",
  matricule: "CD-IN-EL-26-002",
};
const CHILD_B = {
  id: "stu-b",
  name: "Élève B",
  className: "1ère A",
  schoolCode: "SCH-001",
  schoolId: "school-sch-001",
};

function parentState(children: Record<string, unknown>[]) {
  return {
    schools: [{ code: "SCH-001", name: "Lycée Test" }],
    classes: [{ id: "c1", name: "1ère A", schoolCode: "SCH-001" }],
    students: [CHILD_A, CHILD_A2, CHILD_B],
    teachers: [],
    assignments: [],
    courses: [],
    contacts: [],
    relations: [],
    users: [],
    exams: [],
    evaluations: evaluationsForPage.current,
    grades: gradesForPage.current,
    notes: gradesForPage.current,
    academicConfigs: { "SCH-001": { periods: [{ name: "Trimestre 1" }, { name: "Trimestre 2" }] } },
    rolePermissions: {},
    auditLog: [],
    parentChildren: children,
  };
}

function renderPage(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/notes${search}`]}>
      <GradesEvaluationsPage />
    </MemoryRouter>,
  );
}

describe("GradesEvaluationsPage — parcours Parent", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
    evaluationsForPage.current = [
      {
        id: "EVAL-1",
        title: "Interrogation 1",
        subject: "Mathématiques",
        className: "1ère A",
        period: "Trimestre 1",
        status: "Publiée",
        schoolCode: "SCH-001",
        scale: 20,
        coefficient: 1,
        evaluationType: "Interrogation",
        active: true,
        date: "2026-09-01",
      },
    ];
    gradesForPage.current = [
      {
        id: "grade-a",
        studentId: "stu-a",
        evaluationId: "EVAL-1",
        subject: "Mathématiques",
        period: "Trimestre 1",
        value: 16,
        scale: 20,
        gradeStatus: "Validée",
        schoolCode: "SCH-001",
        date: "2026-09-01",
      },
      {
        id: "grade-b",
        studentId: "stu-b",
        evaluationId: "EVAL-1",
        subject: "Mathématiques",
        period: "Trimestre 1",
        value: 4,
        scale: 20,
        gradeStatus: "Validée",
        schoolCode: "SCH-001",
      },
    ];
    sessionUser.current = {
      id: "parent-a",
      role: "Parent",
      roleKeys: ["PARENT"],
      schoolCode: "SCH-001",
      schoolId: "school-sch-001",
      schoolPublicCode: "CD02",
      name: "Parent A",
      children: [CHILD_A],
    };
    dataState.current = parentState([CHILD_A]);
  });

  it("Parent A voit l'enfant A et pas l'élève B", () => {
    renderPage();
    expect(screen.getAllByText("Maeve Okito").length).toBeGreaterThan(0);
    expect(screen.queryByText("Élève B")).not.toBeInTheDocument();
    expect(screen.queryByText("Lina Okito")).not.toBeInTheDocument();
  });

  it("Parent avec deux enfants ne propose que A1 et A2", () => {
    sessionUser.current = { ...sessionUser.current, children: [CHILD_A, CHILD_A2] };
    dataState.current = parentState([CHILD_A, CHILD_A2]);
    renderPage();
    const childSelect = screen.getByLabelText("Enfant") as HTMLSelectElement;
    const labels = [...childSelect.options].map((option) => option.text);
    expect(labels).toContain("Maeve Okito");
    expect(labels).toContain("Lina Okito");
    expect(labels).not.toContain("Élève B");
    expect(childSelect.value).toBe("");
  });

  it("un seul enfant : sélection automatique", () => {
    renderPage();
    const childSelect = screen.getByLabelText("Enfant") as HTMLSelectElement;
    expect(childSelect.value).toBe("stu-a");
  });

  it("Parent ne voit pas Saisie des notes et voit le sélecteur Cours", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: "Saisie des notes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notes" })).toBeInTheDocument();
    expect(screen.getByLabelText("Cours")).toBeInTheDocument();
    expect(screen.getByText("Tous les cours")).toBeInTheDocument();
  });

  it("Parent ne voit pas Par classe / classement / meilleure / plus faible", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: "Par classe" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Statistiques" })).not.toBeInTheDocument();
    expect(screen.queryByText("Classement — 1ère A")).not.toBeInTheDocument();
    expect(screen.queryByText("Meilleure moyenne")).not.toBeInTheDocument();
    expect(screen.queryByText("Plus faible")).not.toBeInTheDocument();
    expect(screen.queryByText("Rang")).not.toBeInTheDocument();
    expect(screen.queryByText("3e / 28")).not.toBeInTheDocument();
  });

  it("classe en lecture seule", () => {
    renderPage();
    expect(screen.getByText("1ère A CD02")).toBeInTheDocument();
    expect(screen.queryByLabelText("Classe")).not.toBeInTheDocument();
  });

  it("studentId enfant B dans l'URL ne sélectionne pas B", () => {
    renderPage("?studentId=stu-b");
    expect(screen.queryByText("Élève B")).not.toBeInTheDocument();
    const childSelect = screen.getByLabelText("Enfant") as HTMLSelectElement;
    expect(childSelect.value).toBe("stu-a");
  });

  it("Teacher/Admin conservent Saisie des notes et Par classe", () => {
    sessionUser.current = {
      id: "u1",
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "SCH-001",
      schoolId: "school-sch-001",
      schoolPublicCode: "SCH-001",
      name: "Admin",
    };
    dataState.current = parentState([]);
    renderPage();
    expect(screen.getByRole("button", { name: "Saisie des notes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Par classe" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Par classe" }));
    expect(screen.getByText("ClassGradesOverview mock")).toBeInTheDocument();
  });
});
