import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: false,
}));

const dataLoading = vi.hoisted(() => ({ current: false }));

const sessionUser = vi.hoisted(() => ({
  current: {
    id: "u1",
    role: "Admin School",
    schoolCode: "SCH-001",
    name: "Admin",
  } as {
    id: string;
    role: string;
    schoolCode: string;
    name?: string;
    assignments?: Record<string, unknown>[];
  },
}));

const gradesPeriod = vi.hoisted(() => ({ current: "Trimestre 3" }));

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
    academicConfigs: {
      "SCH-001": {
        periods: [{ name: "Trimestre 1" }, { name: "Trimestre 2" }, { name: "Trimestre 3" }],
      },
    },
    rolePermissions: {},
    auditLog: [],
  } as Record<string, unknown>,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: sessionUser.current,
    },
  }),
}));

const refreshApi = vi.hoisted(() => vi.fn<(domains?: string[]) => Promise<void>>(async () => undefined));
const upsertNoteApi = vi.hoisted(() =>
  vi.fn<(note: Record<string, unknown>) => Promise<Record<string, unknown>>>(async () => ({})),
);
const showToastApi = vi.hoisted(() => vi.fn());
const confirmApi = vi.hoisted(() => vi.fn(async () => true));
const gradeEntryGridProps = vi.hoisted(() => ({
  current: null as null | {
    onSave: (grades: unknown[]) => Promise<void>;
    onDirtyChange?: (dirty: boolean) => void;
  },
}));

vi.mock("../context/DataContext", () => ({
  useData: () => ({
    state: dataState.current,
    loading: dataLoading.current,
    error: null,
    syncJournal: [],
    update: vi.fn(),
    refresh: refreshApi,
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

const evaluationsForPage = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));
const gradesForPage = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));
const updateEvaluationApi = vi.hoisted(() =>
  vi.fn<(id: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>>(async () => ({})),
);

vi.mock("../lib/evaluations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/evaluations")>();
  return {
    ...actual,
    buildEvaluationsFromExams: () => [],
    ensureEvaluationsSynced: () => evaluationsForPage.current,
    scopedEvaluations: (_user: unknown, state: { evaluations?: Record<string, unknown>[] }) => {
      const school = String(sessionUser.current.schoolCode ?? "");
      return (evaluationsForPage.current.length ? evaluationsForPage.current : state.evaluations ?? []).filter(
        (row) => !school || String(row.schoolCode ?? school) === school,
      );
    },
    scopedGrades: () => gradesForPage.current as never[],
    allGrades: () => gradesForPage.current as never[],
    resolveGradesPeriod: () => gradesPeriod.current,
    canEditEvaluation: () => true,
  };
});

vi.mock("../lib/pedagogyApi", () => ({
  pedagogyApi: {
    createEvaluation: vi.fn(),
    updateEvaluation: (id: string, payload: Record<string, unknown>) => updateEvaluationApi(id, payload),
    listEvaluations: vi.fn(),
    upsertNote: (note: Record<string, unknown>) => upsertNoteApi(note),
  },
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast: showToastApi }),
}));

vi.mock("../components/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: confirmApi }),
}));

vi.mock("../components/ui/PrintButton", () => ({
  PrintButton: () => <button type="button">Imprimer</button>,
}));

vi.mock("../components/grades/EvaluationFormModal", () => ({
  EvaluationFormModal: () => null,
}));

vi.mock("../components/grades/GradeEntryGrid", () => ({
  GradeEntryGrid: (props: {
    onSave: (grades: unknown[]) => Promise<void>;
    onDirtyChange?: (dirty: boolean) => void;
  }) => {
    gradeEntryGridProps.current = props;
    return <div>GradeEntryGrid mock</div>;
  },
}));

vi.mock("../components/grades/ClassGradesOverview", () => ({
  ClassGradesOverview: () => <div>ClassGradesOverview mock</div>,
}));

vi.mock("../components/grades/StudentGradesPanel", () => ({
  StudentGradesPanel: () => <div>StudentGradesPanel mock</div>,
}));

import { GradesEvaluationsPage } from "./GradesEvaluationsPage";

const interrogation1 = {
  id: "EVAL-1",
  title: "Interrogation 1",
  subject: "Mathématiques",
  className: "2ème A",
  period: "Trimestre 1",
  status: "Brouillon",
  schoolCode: "SCH-001",
  scale: 20,
  coefficient: 1,
  evaluationType: "Interrogation",
  active: true,
};

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
    dataLoading.current = false;
    evaluationsForPage.current = [];
    gradesForPage.current = [];
    dataState.current = { ...dataState.current, evaluations: [] };
    sessionUser.current = {
      id: "u1",
      role: "Admin School",
      schoolCode: "SCH-001",
      name: "Admin",
    };
    gradesPeriod.current = "Trimestre 3";
    updateEvaluationApi.mockClear();
    refreshApi.mockClear();
    upsertNoteApi.mockClear();
    showToastApi.mockClear();
    confirmApi.mockClear();
    confirmApi.mockResolvedValue(true);
    upsertNoteApi.mockResolvedValue({});
    refreshApi.mockResolvedValue(undefined);
    gradeEntryGridProps.current = null;
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

  it("affiche EmptyState lorsqu'il n'y a aucune évaluation", () => {
    renderPage();

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Aucune évaluation");
    expect(status).toHaveTextContent("Aucune évaluation à valider.");
  });

  it("remplace le champ Période texte par un Select canonique", () => {
    renderPage();
    const period = screen.getByLabelText("Période") as HTMLSelectElement;
    expect(period.tagName).toBe("SELECT");
    expect([...period.options].map((option) => option.text)).toEqual([
      "Toutes les périodes",
      "Trimestre 1",
      "Trimestre 2",
      "Trimestre 3",
    ]);
  });

  it("affiche LoadingState pendant le chargement des données", () => {
    dataLoading.current = true;
    renderPage();

    expect(screen.getByText("Chargement des notes et évaluations…")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Notes & évaluations" })).not.toBeInTheDocument();
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

  it("affiche Nouvelle évaluation si Notes:CREATE", () => {
    permissions.canCreate = true;
    renderPage();
    expect(screen.getAllByRole("button", { name: "Nouvelle évaluation" }).length).toBeGreaterThan(0);
  });

  it("masque Nouvelle évaluation après revoke applicatif CREATE (sans re-login)", () => {
    permissions.canCreate = false;
    permissions.canUpdate = true;
    renderPage();
    expect(screen.queryByRole("button", { name: "Nouvelle évaluation" })).not.toBeInTheDocument();
  });

  it("masque Modifier si UPDATE absent", () => {
    permissions.canCreate = true;
    permissions.canUpdate = false;
    evaluationsForPage.current = [
      {
        id: "ev1",
        title: "Interro 1",
        subject: "Maths",
        className: "6e A",
        period: "T1",
        status: "Saisie",
        schoolCode: "SCH-001",
      },
    ];
    renderPage();
    expect(screen.queryByRole("button", { name: "Modifier" })).not.toBeInTheDocument();
  });

  it("affiche Modifier si UPDATE présent", () => {
    permissions.canUpdate = true;
    evaluationsForPage.current = [
      {
        id: "ev1",
        title: "Interro 1",
        subject: "Maths",
        className: "6e A",
        period: "T1",
        status: "Saisie",
        schoolCode: "SCH-001",
      },
    ];
    renderPage();
    expect(screen.getByRole("button", { name: "Modifier" })).toBeInTheDocument();
  });
});

describe("GradesEvaluationsPage — file Préfet À valider", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
    dataLoading.current = false;
    gradesPeriod.current = "Trimestre 3";
    sessionUser.current = {
      id: "prefet-jp",
      role: "Préfet des études",
      schoolCode: "SCH-001",
      name: "Jean Pierre",
    };
    evaluationsForPage.current = [interrogation1];
    dataState.current = { ...dataState.current, evaluations: [interrogation1] };
    updateEvaluationApi.mockClear();
  });

  it("Préfet + période active Trimestre 3 : Interrogation 1 visible dans À valider, bouton Valider", () => {
    renderPage();

    expect(screen.getByLabelText("Statut")).toHaveValue("a-valider");
    expect(screen.getByLabelText("Période")).toHaveValue("");
    expect(screen.getByText("Interrogation 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Valider" })).toBeInTheDocument();
  });

  it("filtre Trimestre 1 visible, Trimestre 3 absente, Toutes les périodes visible", () => {
    renderPage();

    fireEvent.change(screen.getByLabelText("Période"), { target: { value: "Trimestre 1" } });
    expect(screen.getByText("Interrogation 1")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Période"), { target: { value: "Trimestre 3" } });
    expect(screen.queryByText("Interrogation 1")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Aucune évaluation pour la période « Trimestre 3 ».");

    fireEvent.change(screen.getByLabelText("Période"), { target: { value: "" } });
    expect(screen.getByText("Interrogation 1")).toBeInTheDocument();
  });

  it("Validée disparaît de À valider", () => {
    evaluationsForPage.current = [{ ...interrogation1, status: "Validée" }];
    dataState.current = { ...dataState.current, evaluations: evaluationsForPage.current };
    renderPage();
    expect(screen.queryByText("Interrogation 1")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Aucune évaluation à valider.");
  });

  it("autre établissement invisible (scope schoolCode amont)", () => {
    sessionUser.current = { ...sessionUser.current, schoolCode: "SCH-001" };
    evaluationsForPage.current = [{ ...interrogation1, schoolCode: "BI-2026-0002" }];
    dataState.current = { ...dataState.current, evaluations: evaluationsForPage.current };
    renderPage();
    expect(screen.queryByText("Interrogation 1")).not.toBeInTheDocument();
  });

  it("Valider → PATCH /evaluations/:id avec statut Validée", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    await waitFor(() => {
      expect(updateEvaluationApi).toHaveBeenCalledWith(
        "EVAL-1",
        expect.objectContaining({ status: "Validée" }),
      );
    });
  });
});

describe("GradesEvaluationsPage — enseignant conserve la période active", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
    dataLoading.current = false;
    gradesPeriod.current = "Trimestre 3";
    sessionUser.current = {
      id: "ens-seke",
      role: "Enseignant",
      schoolCode: "SCH-001",
      name: "Seke",
    };
    evaluationsForPage.current = [interrogation1];
    dataState.current = { ...dataState.current, evaluations: [interrogation1] };
  });

  it("n'affiche pas le filtre Statut et masque Trimestre 1 tant que Trimestre 3 est le défaut", async () => {
    renderPage();
    expect(screen.queryByLabelText("Statut")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText("Période")).toHaveValue("Trimestre 3");
    });
    expect(screen.queryByText("Interrogation 1")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Période"), { target: { value: "Trimestre 1" } });
    expect(screen.getByText("Interrogation 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Valider" })).not.toBeInTheDocument();
  });
});

describe("GradesEvaluationsPage — Saisie des notes Validée uniquement", () => {
  const lesAdverbes = {
    id: "EVAL-ADV",
    title: "LES ADVERBES",
    subject: "Mathématiques",
    className: "6e A",
    classId: "c1",
    period: "Trimestre 1",
    status: "Brouillon",
    schoolCode: "SCH-001",
    scale: 20,
    coefficient: 1,
    evaluationType: "Devoir",
    active: true,
    teacherId: "ENS-0001",
  };

  const sekeAssignments = [
    {
      classId: "c1",
      className: "6e A",
      course: "Mathématiques",
      status: "active",
    },
  ];

  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
    dataLoading.current = false;
    gradesPeriod.current = "Trimestre 3";
    sessionUser.current = {
      id: "ens-seke",
      role: "Enseignant",
      schoolCode: "SCH-001",
      name: "Seke",
      assignments: sekeAssignments,
    };
    evaluationsForPage.current = [lesAdverbes];
    dataState.current = { ...dataState.current, evaluations: [lesAdverbes] };
    refreshApi.mockClear();
    upsertNoteApi.mockClear();
    showToastApi.mockClear();
    confirmApi.mockClear();
    confirmApi.mockResolvedValue(true);
    upsertNoteApi.mockResolvedValue({});
    refreshApi.mockResolvedValue(undefined);
    gradeEntryGridProps.current = null;
  });

  it("Brouillon absente du select Saisie des notes", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Saisie des notes" }));
    const select = screen.getByLabelText("Évaluation") as HTMLSelectElement;
    expect([...select.options].map((option) => option.text).join(" ")).not.toContain("LES ADVERBES");
  });

  it("Validée Trimestre 1 visible dans Saisie même si la période active est Trimestre 3", () => {
    evaluationsForPage.current = [{ ...lesAdverbes, status: "Validée" }];
    dataState.current = { ...dataState.current, evaluations: evaluationsForPage.current };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Saisie des notes" }));
    expect(screen.getByLabelText("Période")).toHaveValue("Trimestre 3");
    const select = screen.getByLabelText("Évaluation") as HTMLSelectElement;
    expect([...select.options].map((option) => option.text).join(" ")).toContain("LES ADVERBES");
  });

  it("Enseignant : bouton Valider absent après refresh Validée", () => {
    evaluationsForPage.current = [{ ...lesAdverbes, status: "Validée" }];
    dataState.current = { ...dataState.current, evaluations: evaluationsForPage.current };
    renderPage();
    expect(screen.queryByRole("button", { name: "Valider" })).not.toBeInTheDocument();
  });

  it("handleSaveGrades : N écritures /notes puis un seul refresh notes", async () => {
    evaluationsForPage.current = [{ ...lesAdverbes, status: "Validée" }];
    dataState.current = { ...dataState.current, evaluations: evaluationsForPage.current };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Saisie des notes" }));
    fireEvent.change(screen.getByLabelText("Évaluation"), { target: { value: "EVAL-ADV" } });

    await waitFor(() => expect(gradeEntryGridProps.current?.onSave).toEqual(expect.any(Function)));

    const batch = [
      {
        id: "g1",
        schoolCode: "SCH-001",
        studentId: "s1",
        studentName: "Diallo Awa",
        evaluationId: "EVAL-ADV",
        subject: "Mathématiques",
        className: "6e A",
        period: "Trimestre 1",
        value: 14,
        scale: 20,
        gradeStatus: "Saisie",
      },
      {
        id: "g2",
        schoolCode: "SCH-001",
        studentId: "s2",
        studentName: "Jean Kouassi",
        evaluationId: "EVAL-ADV",
        subject: "Mathématiques",
        className: "6e A",
        period: "Trimestre 1",
        value: 12,
        scale: 20,
        gradeStatus: "Saisie",
      },
      {
        id: "g3",
        schoolCode: "SCH-001",
        studentId: "s3",
        studentName: "Riziki Masumbuko",
        evaluationId: "EVAL-ADV",
        subject: "Mathématiques",
        className: "6e A",
        period: "Trimestre 1",
        value: 9,
        scale: 20,
        gradeStatus: "Saisie",
      },
    ];

    await gradeEntryGridProps.current!.onSave(batch);

    expect(upsertNoteApi).toHaveBeenCalledTimes(3);
    expect(upsertNoteApi.mock.calls.map((call) => call[0].studentId)).toEqual(["s1", "s2", "s3"]);
    for (const [payload] of upsertNoteApi.mock.calls) {
      expect(payload.teacherId).toBe("ENS-0001");
      expect(payload.authorId).toBeUndefined();
    }
    expect(refreshApi).toHaveBeenCalledTimes(1);
    expect(refreshApi).toHaveBeenCalledWith(["notes"]);
    expect(showToastApi).toHaveBeenCalledWith("Notes enregistrées");
  });

  it("handleSaveGrades : POST partiel en échec → aucun refresh", async () => {
    evaluationsForPage.current = [{ ...lesAdverbes, status: "Validée" }];
    dataState.current = { ...dataState.current, evaluations: evaluationsForPage.current };
    upsertNoteApi.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("échec réseau"));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Saisie des notes" }));
    fireEvent.change(screen.getByLabelText("Évaluation"), { target: { value: "EVAL-ADV" } });

    await waitFor(() => expect(gradeEntryGridProps.current?.onSave).toEqual(expect.any(Function)));

    await expect(
      gradeEntryGridProps.current!.onSave([
        {
          id: "g1",
          studentId: "s1",
          studentName: "Diallo Awa",
          evaluationId: "EVAL-ADV",
          value: 14,
          gradeStatus: "Saisie",
        },
        {
          id: "g2",
          studentId: "s2",
          studentName: "Jean Kouassi",
          evaluationId: "EVAL-ADV",
          value: 12,
          gradeStatus: "Saisie",
        },
      ]),
    ).rejects.toThrow("Jean Kouassi : échec réseau");

    expect(upsertNoteApi).toHaveBeenCalledTimes(2);
    expect(refreshApi).not.toHaveBeenCalled();
    expect(showToastApi).not.toHaveBeenCalledWith("Notes enregistrées");
  });

  it("garde les drafts dirty : confirmation avant changement de période", async () => {
    evaluationsForPage.current = [{ ...lesAdverbes, status: "Validée" }];
    dataState.current = { ...dataState.current, evaluations: evaluationsForPage.current };
    confirmApi.mockResolvedValue(false);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Saisie des notes" }));
    fireEvent.change(screen.getByLabelText("Évaluation"), { target: { value: "EVAL-ADV" } });

    await waitFor(() => expect(gradeEntryGridProps.current?.onDirtyChange).toEqual(expect.any(Function)));
    act(() => {
      gradeEntryGridProps.current!.onDirtyChange?.(true);
    });

    const period = screen.getByLabelText("Période") as HTMLSelectElement;
    expect(period).toHaveValue("Trimestre 3");
    fireEvent.change(period, { target: { value: "Trimestre 1" } });

    await waitFor(() => expect(confirmApi).toHaveBeenCalled());
    expect(confirmApi).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Des notes non enregistrées seront perdues. Continuer ?",
      }),
    );
    expect(period).toHaveValue("Trimestre 3");
  });

  it("handleSaveGrades refuse une évaluation sans teacherId pédagogique", async () => {
    evaluationsForPage.current = [{ ...lesAdverbes, status: "Validée", teacherId: "" }];
    dataState.current = { ...dataState.current, evaluations: evaluationsForPage.current };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Saisie des notes" }));
    fireEvent.change(screen.getByLabelText("Évaluation"), { target: { value: "EVAL-ADV" } });

    await waitFor(() => expect(gradeEntryGridProps.current?.onSave).toEqual(expect.any(Function)));

    await expect(
      gradeEntryGridProps.current!.onSave([
        {
          id: "g1",
          studentId: "s1",
          studentName: "Diallo Awa",
          evaluationId: "EVAL-ADV",
          value: 14,
          gradeStatus: "Saisie",
        },
      ]),
    ).rejects.toThrow("Aucun enseignant n'est affecté à cette évaluation");

    expect(upsertNoteApi).not.toHaveBeenCalled();
  });
});

describe("GradesEvaluationsPage — refresh puis mutation Préfet", () => {
  const evaluationBase = {
    id: "EVAL-ADV",
    title: "LES ADVERBES",
    subject: "Mathématiques",
    className: "6e A",
    classId: "c1",
    period: "Trimestre 1",
    schoolCode: "SCH-001",
    scale: 20,
    coefficient: 1,
    evaluationType: "Devoir",
    active: true,
    teacherId: "ENS-0001",
  };
  const refreshedNote = {
    id: "g-refresh",
    schoolCode: "SCH-001",
    studentId: "s1",
    studentName: "Diallo Awa",
    evaluationId: "EVAL-ADV",
    subject: "Mathématiques",
    className: "6e A",
    period: "Trimestre 1",
    value: 14,
    scale: 20,
    gradeStatus: "Validée",
    teacherId: "",
    authorId: "prefet-fideline",
  };

  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
    dataLoading.current = false;
    gradesPeriod.current = "Trimestre 1";
    sessionUser.current = {
      id: "prefet-fideline",
      role: "Préfet des études",
      schoolCode: "SCH-001",
      name: "FIDELINE SHISHO",
    };
    gradesForPage.current = [refreshedNote];
    upsertNoteApi.mockClear();
    upsertNoteApi.mockResolvedValue({});
    refreshApi.mockClear();
    refreshApi.mockResolvedValue(undefined);
    showToastApi.mockClear();
    updateEvaluationApi.mockClear();
    updateEvaluationApi.mockResolvedValue({});
    gradeEntryGridProps.current = null;
  });

  it("saisie → refresh → validation : teacherId pédagogique, pas authorId", async () => {
    const evaluation = { ...evaluationBase, status: "Ouverte" };
    evaluationsForPage.current = [evaluation];
    dataState.current = { ...dataState.current, evaluations: [evaluation], notes: [refreshedNote] };
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    await waitFor(() => expect(upsertNoteApi).toHaveBeenCalled());
    for (const [payload] of upsertNoteApi.mock.calls) {
      expect(payload.teacherId).toBe("ENS-0001");
      expect(payload.authorId).toBeUndefined();
    }
  });

  it("saisie → refresh → correction : teacherId pédagogique, pas authorId", async () => {
    const evaluation = { ...evaluationBase, status: "Validée" };
    evaluationsForPage.current = [evaluation];
    dataState.current = { ...dataState.current, evaluations: [evaluation], notes: [refreshedNote] };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Saisie des notes" }));
    fireEvent.change(screen.getByLabelText("Évaluation"), { target: { value: "EVAL-ADV" } });
    fireEvent.click(await screen.findByRole("button", { name: "Corriger une note validée" }));
    expect(showToastApi).not.toHaveBeenCalledWith(
      "Aucune note validée à corriger pour cette évaluation.",
      "error",
    );
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Nouvelle note/i), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText(/Motif/i), { target: { value: "Erreur de saisie" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la correction" }));

    await waitFor(() => expect(upsertNoteApi).toHaveBeenCalled());
    for (const [payload] of upsertNoteApi.mock.calls) {
      expect(payload.teacherId).toBe("ENS-0001");
      expect(payload.authorId).toBeUndefined();
    }
  });
});
