/**
 * DEEPLINK-NOTE — `/notes?gradeId=…` doit positionner la page sur l'élève, la
 * période et l'évaluation de la note visée, et mettre cette note en évidence.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const permissions = vi.hoisted(() => ({ canRead: true, canCreate: true, canUpdate: true, canDelete: false }));

const sessionUser = vi.hoisted(() => ({
  current: {
    id: "u1",
    role: "Admin School",
    schoolCode: "SCH-001",
    schoolId: "school-sch-001",
    schoolPublicCode: "SCH-001",
    name: "Admin",
  },
}));

const EVALUATIONS = [
  {
    id: "EVAL-1",
    title: "Interrogation 1",
    subject: "Mathématiques",
    className: "6e A",
    period: "Trimestre 1",
    status: "Publiée",
    schoolCode: "SCH-001",
    scale: 20,
    coefficient: 1,
    evaluationType: "Interrogation",
    active: true,
  },
];

const GRADES = [
  {
    id: "grade-1",
    studentId: "s1",
    evaluationId: "EVAL-1",
    subject: "Mathématiques",
    period: "Trimestre 1",
    value: 14,
    scale: 20,
    gradeStatus: "Validée",
    validatedAt: "2026-09-01",
    schoolCode: "SCH-001",
  },
  {
    id: "grade-2",
    studentId: "s1",
    evaluationId: "EVAL-1",
    subject: "Français",
    period: "Trimestre 1",
    value: 11,
    scale: 20,
    gradeStatus: "Validée",
    validatedAt: "2026-09-02",
    schoolCode: "SCH-001",
  },
];

const dataState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

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
    ensureEvaluationsSynced: () => EVALUATIONS,
    scopedEvaluations: () => EVALUATIONS as never[],
    scopedGrades: () => GRADES as never[],
    allGrades: () => GRADES as never[],
    resolveGradesPeriod: () => "Trimestre 1",
    canEditEvaluation: () => true,
    buildGradeBook: () => ({ getStudentAverage: () => null }),
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

vi.mock("../components/ui/Toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../components/ui/ConfirmDialog", () => ({ useConfirm: () => ({ confirm: vi.fn(async () => true) }) }));
vi.mock("../components/ui/PrintButton", () => ({ PrintButton: () => <button type="button">Imprimer</button> }));
vi.mock("../components/grades/EvaluationFormModal", () => ({ EvaluationFormModal: () => null }));
vi.mock("../components/grades/GradeEntryGrid", () => ({ GradeEntryGrid: () => <div>GradeEntryGrid mock</div> }));
vi.mock("../components/grades/ClassGradesOverview", () => ({
  ClassGradesOverview: () => <div>ClassGradesOverview mock</div>,
}));

import { GradesEvaluationsPage } from "./GradesEvaluationsPage";

function renderPage(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/notes${search}`]}>
      <GradesEvaluationsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permissions.canRead = true;
  dataState.current = {
    schools: [{ code: "SCH-001", name: "Lycée Test" }],
    classes: [{ id: "c1", name: "6e A", schoolCode: "SCH-001" }],
    students: [
      { id: "s1", name: "Diallo Awa", className: "6e A", schoolCode: "SCH-001", schoolId: "school-sch-001" },
      { id: "s2", name: "Binta Traoré", className: "6e A", schoolCode: "SCH-001", schoolId: "school-sch-001" },
    ],
    teachers: [],
    assignments: [],
    courses: [],
    contacts: [],
    relations: [],
    users: [],
    exams: [],
    evaluations: EVALUATIONS,
    grades: GRADES,
    notes: GRADES,
    academicConfigs: { "SCH-001": { periods: [{ name: "Trimestre 1" }, { name: "Trimestre 2" }] } },
    rolePermissions: {},
    auditLog: [],
  };
});

describe("DEEPLINK-NOTE — la page Notes consomme gradeId", () => {
  it("DEEPLINK-NOTE-01 — la note visée ouvre la vue élève et est mise en évidence", async () => {
    renderPage("?gradeId=grade-2");

    expect((await screen.findAllByText("Diallo Awa")).length).toBeGreaterThan(0);
    const rows = await waitFor(() => {
      const selected = document.querySelectorAll('tr[data-selected="true"]');
      expect(selected.length).toBe(1);
      return Array.from(selected);
    });
    expect(rows[0]).toHaveTextContent("Français");
    expect(rows[0]).toHaveTextContent("11/20");
  });

  it("DEEPLINK-NOTE-02 — sans paramètre, la page reste sur la file des évaluations", async () => {
    renderPage("");
    await screen.findByText("Par élève");
    expect(document.querySelectorAll('tr[data-selected="true"]')).toHaveLength(0);
  });

  it("DEEPLINK-NOTE-03 — une note hors périmètre ne change pas le contexte", async () => {
    renderPage("?gradeId=grade-autre-ecole");
    await screen.findByText("Par élève");
    expect(document.querySelectorAll('tr[data-selected="true"]')).toHaveLength(0);
  });
});
