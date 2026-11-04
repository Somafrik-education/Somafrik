import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PresencesPage } from "./PresencesPage";
import { api } from "../api/client";

/** Les pages applicatives sont montées sous le Router : le deep-link lit l'URL. */
function RoutedPresencesPage() {
  return (
    <MemoryRouter>
      <PresencesPage />
    </MemoryRouter>
  );
}
import { ATTENDANCE_PEDAGOGICAL_TEACHER_COPY } from "../lib/attendanceAuthor";
import { readFileSync } from "node:fs";
import path from "node:path";

const showToast = vi.hoisted(() => vi.fn());
const classStudentsList = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

const authSession = vi.hoisted(() => ({
  user: { id: "admin-1", role: "Admin School", schoolCode: "SCH-001", name: "Admin" } as Record<string, unknown>,
}));

const dataState = vi.hoisted(() => ({
  classes: [
    {
      id: "aaaaaaaa-0000-4000-8000-00000000000a",
      classId: "aaaaaaaa-0000-4000-8000-00000000000a",
      classCode: "CLS-A",
      name: "2ème A",
      students: 1,
    },
    {
      id: "bbbbbbbb-0000-4000-8000-00000000000b",
      classId: "bbbbbbbb-0000-4000-8000-00000000000b",
      classCode: "CLS-B",
      name: "2ème A",
      students: 0,
    },
  ],
  assignments: [] as Record<string, unknown>[],
  teachers: [] as Record<string, unknown>[],
  students: [] as Record<string, unknown>[],
  presences: [] as Record<string, unknown>[],
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: authSession,
  }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    scopedUser: authSession.user,
  }),
}));

vi.mock("../context/DataContext", () => ({
  useData: () => ({
    state: dataState,
    refresh,
    update: vi.fn(),
    invalidateDomains: vi.fn(),
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({ user: { role: "Admin School", schoolCode: "SCH-001" } }),
  useFeaturePermissions: () => ({ canRead: true, canUpdate: true }),
}));

vi.mock("../lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/permissions")>();
  return {
    ...actual,
    canManagePresences: () => true,
  };
});

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("../lib/classStudentsApi", () => ({
  classStudentsApi: {
    list: classStudentsList,
  },
}));

vi.mock("../api/client", () => ({
  api: {
    post: apiPost,
    get: vi.fn(async (path: string) => {
      // PERF-PR3 : le personnel lit /v2/presences (page SQL) ; mêmes données que dataState.
      const url = new URL(`http://test${path.startsWith("/") ? "" : "/"}${path}`);
      if (url.pathname !== "/v2/presences") return [];
      const date = url.searchParams.get("date");
      const attendanceId = url.searchParams.get("attendanceId");
      const classId = url.searchParams.get("classId");
      const items = dataState.presences.filter(
        (row) =>
          (!date || String(row.date ?? "") === date) &&
          (!classId || String(row.classId ?? "") === classId) &&
          (!attendanceId || String(row.id ?? "") === attendanceId),
      );
      return { items, nextCursor: null, hasMore: false };
    }),
  },
}));

describe("PresencesPage — roster canonique", () => {
  beforeEach(() => {
    showToast.mockReset();
    refresh.mockReset();
    apiPost.mockReset();
    classStudentsList.mockReset();
    authSession.user = { id: "admin-1", role: "Admin School", schoolCode: "SCH-001", name: "Admin" };
    dataState.classes = [
      { id: "aaaaaaaa-0000-4000-8000-00000000000a", classId: "aaaaaaaa-0000-4000-8000-00000000000a", classCode: "CLS-A", name: "2ème A", students: 1 },
      { id: "bbbbbbbb-0000-4000-8000-00000000000b", classId: "bbbbbbbb-0000-4000-8000-00000000000b", classCode: "CLS-B", name: "2ème A", students: 0 },
    ];
    dataState.assignments = [];
    dataState.teachers = [];
    dataState.students = [];
    dataState.presences = [];
    classStudentsList.mockResolvedValue([
      {
        id: "ELE-1",
        publicId: "ELE-1",
        studentCode: "ELE-1",
        matricule: "ELE-1",
        firstName: "Awa",
        lastName: "Diop",
        name: "Awa Diop",
        classId: "aaaaaaaa-0000-4000-8000-00000000000a",
        classCode: "CLS-A",
        className: "",
      },
    ]);
  });

  it("affiche deux cartes homonymes et le compteur PG, pas un filtre className", async () => {
    render(<RoutedPresencesPage />);
    const cards = await screen.findAllByRole("button");
    const secondA = cards.filter((node) => node.textContent?.includes("2ème A"));
    expect(secondA).toHaveLength(2);
    expect(secondA[0].textContent).toMatch(/1 élève/);
    expect(secondA[0].textContent).toMatch(/Non saisi/);
    expect(secondA[1].textContent).toMatch(/0 élève/);
    expect(secondA[1].textContent).toMatch(/Présence —/);
  });

  it("#759 — 1ère Primaire A affiche 6 et le badge du jour quand /classes annonce 0", async () => {
    const now = new Date();
    const isoToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const students = Array.from({ length: 6 }, (_, index) => ({
      id: `ELE-${index + 1}`,
      matricule: `ELE-${index + 1}`,
      classId: "cccccccc-0000-4000-8000-0000000000c1",
      classCode: "CLS-P1A",
      status: "active",
    }));
    dataState.classes = [
      { id: "cccccccc-0000-4000-8000-0000000000c1", classId: "cccccccc-0000-4000-8000-0000000000c1", classCode: "CLS-P1A", name: "1ère Primaire A", students: 0 },
    ];
    dataState.students = students;
    dataState.presences = students.map((student, index) => ({
      studentId: student.id,
      classId: "cccccccc-0000-4000-8000-0000000000c1",
      classCode: "CLS-P1A",
      date: isoToday,
      status: index === 0 ? "Absent" : "Présent",
      present: index !== 0,
    }));

    render(<RoutedPresencesPage />);
    const card = (await screen.findAllByRole("button")).find((node) =>
      node.textContent?.includes("1ère Primaire A"),
    );
    expect(card?.textContent).toMatch(/6 élève/);
    expect(card?.textContent).not.toMatch(/0 élève/);
    expect(card?.textContent).toMatch(/Présence 83 %/);
    expect(card?.textContent).not.toMatch(/Présence —/);
  });

  it("PARITY-057 — lignes A/B/D ne complètent pas le roster A/B/C", async () => {
    const now = new Date();
    const isoToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    dataState.classes = [{ id: "aaaaaaaa-0000-4000-8000-00000000000a", classId: "aaaaaaaa-0000-4000-8000-00000000000a", classCode: "CLS-A", name: "6ème A", students: 3 }];
    dataState.students = [
      { id: "A", matricule: "A", classId: "aaaaaaaa-0000-4000-8000-00000000000a", classCode: "CLS-A" },
      { id: "B", matricule: "B", classId: "aaaaaaaa-0000-4000-8000-00000000000a", classCode: "CLS-A" },
      { id: "C", matricule: "C", classId: "aaaaaaaa-0000-4000-8000-00000000000a", classCode: "CLS-A" },
    ];
    dataState.presences = [
      { studentId: "A", classId: "aaaaaaaa-0000-4000-8000-00000000000a", classCode: "CLS-A", date: isoToday, status: "Présent", present: true },
      { studentId: "B", classId: "aaaaaaaa-0000-4000-8000-00000000000a", classCode: "CLS-A", date: isoToday, status: "Présent", present: true },
      { studentId: "D", classId: "aaaaaaaa-0000-4000-8000-00000000000a", classCode: "CLS-A", date: isoToday, status: "Présent", present: true },
    ];
    render(<RoutedPresencesPage />);
    const card = (await screen.findAllByRole("button")).find((node) => node.textContent?.includes("6ème A"));
    expect(card?.textContent).toMatch(/Non saisi/);
    expect(card?.textContent).not.toMatch(/Présence \d/);
  });

  it("charge le roster via GET /classes/:classCode/students (cas A className vide)", async () => {
    const user = userEvent.setup();
    render(<RoutedPresencesPage />);
    const cards = await screen.findAllByRole("button");
    const classA = cards.find((node) => node.textContent?.includes("1 élève")) as HTMLElement;
    await user.click(classA);
    await waitFor(() => {
      expect(classStudentsList).toHaveBeenCalledWith("CLS-A");
    });
    expect(await screen.findByText("Awa Diop")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tout présent" })).toBeInTheDocument();
  });

  it("n'expose plus assignStudentToClass ni update({ students })", () => {
    const source = readFileSync(path.join(__dirname, "PresencesPage.tsx"), "utf8");
    expect(source).not.toMatch(/assignStudentToClass/);
    expect(source).not.toMatch(/update\(\{\s*students/);
    expect(source).not.toMatch(/student\.className\s*===\s*selectedClassName/);
    expect(source).not.toMatch(/dedupeClassesByName/);
    expect(source).not.toMatch(/UNASSIGNED_CLASS/);
  });

  it("H — enseignant Seke-like : JWT 2 assignments, state.assignments vide → 2 cartes", async () => {
    authSession.user = {
      id: "user-seke",
      role: "Enseignant",
      schoolCode: "SCH-001",
      assignments: [
        { classId: "aaaaaaaa-0000-4000-8000-00000000000a", classCode: "CLS-A", status: "active" },
        { classId: "bbbbbbbb-0000-4000-8000-00000000000b", classCode: "CLS-B", status: "active" },
      ],
      assignedClassIds: ["aaaaaaaa-0000-4000-8000-00000000000a", "bbbbbbbb-0000-4000-8000-00000000000b"],
      assignedClassCodes: ["CLS-A", "CLS-B"],
    };
    dataState.assignments = [];
    dataState.teachers = [];
    render(<RoutedPresencesPage />);
    const cards = await screen.findAllByRole("button");
    const classCards = cards.filter((node) => node.textContent?.includes("2ème A"));
    expect(classCards).toHaveLength(2);
    expect(screen.queryByText("Aucune classe dans votre périmètre.")).not.toBeInTheDocument();
  });
});

describe("PresencesPage — enseignant pédagogique ≠ acteur JWT", () => {
  beforeEach(() => {
    showToast.mockReset();
    refresh.mockReset();
    apiPost.mockReset();
    classStudentsList.mockReset();
    authSession.user = { id: "admin-1", role: "Admin School", schoolCode: "SCH-001", name: "Admin" };
    dataState.classes = [
      { id: "aaaaaaaa-0000-4000-8000-00000000000a", classId: "aaaaaaaa-0000-4000-8000-00000000000a", classCode: "CLS-A", name: "2ème A", students: 1 },
      { id: "bbbbbbbb-0000-4000-8000-00000000000b", classId: "bbbbbbbb-0000-4000-8000-00000000000b", classCode: "CLS-B", name: "2ème A", students: 0 },
    ];
    dataState.assignments = [];
    dataState.teachers = [];
    dataState.students = [];
    dataState.presences = [];
    classStudentsList.mockResolvedValue([
      {
        id: "ELE-1",
        publicId: "ELE-1",
        studentCode: "ELE-1",
        matricule: "ELE-1",
        firstName: "Awa",
        lastName: "Diop",
        name: "Awa Diop",
        classId: "aaaaaaaa-0000-4000-8000-00000000000a",
        classCode: "CLS-A",
        className: "",
      },
    ]);
  });

  async function openClassWithRoster() {
    const user = userEvent.setup();
    render(<RoutedPresencesPage />);
    const cards = await screen.findAllByRole("button");
    const classA = cards.find((node) => node.textContent?.includes("1 élève")) as HTMLElement;
    await user.click(classA);
    expect(await screen.findByText("Awa Diop")).toBeInTheDocument();
    return user;
  }

  it("admin sans affectation : bloque avant POST", async () => {
    await openClassWithRoster();
    expect(screen.getByText(ATTENDANCE_PEDAGOGICAL_TEACHER_COPY.none)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer l'appel" })).toBeDisabled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("admin : une affectation → POST teacherId pédagogique, pas l'acteur", async () => {
    dataState.assignments = [
      {
        teacherId: "ENS-0001",
        teacherName: "Seke",
        classId: "aaaaaaaa-0000-4000-8000-00000000000a",
        classCode: "CLS-A",
        status: "active",
      },
    ];
    apiPost.mockResolvedValue([{ id: "PRE-1", studentId: "ELE-1", status: "Présent" }]);
    const user = await openClassWithRoster();
    await user.click(screen.getByRole("button", { name: "Enregistrer l'appel" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const payload = apiPost.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.teacherId).toBe("ENS-0001");
    expect(payload.authorId).toBeUndefined();
    expect((payload.items as Array<Record<string, unknown>>)[0].teacherId).toBe("ENS-0001");
    expect(apiPost.mock.calls[0][0]).toBe("/presences");
  });

  it("Enseignant : POST sans teacherId forgé", async () => {
    authSession.user = {
      id: "user-seke",
      role: "Enseignant",
      schoolCode: "SCH-001",
      assignments: [{ classId: "aaaaaaaa-0000-4000-8000-00000000000a", classCode: "CLS-A", status: "active" }],
      assignedClassIds: ["aaaaaaaa-0000-4000-8000-00000000000a"],
      assignedClassCodes: ["CLS-A"],
    };
    dataState.assignments = [
      { teacherId: "ENS-OTHER", classId: "aaaaaaaa-0000-4000-8000-00000000000a", classCode: "CLS-A", status: "active" },
    ];
    apiPost.mockResolvedValue([{ id: "PRE-1", studentId: "ELE-1", status: "Présent" }]);
    const user = await openClassWithRoster();
    await user.click(screen.getByRole("button", { name: "Enregistrer l'appel" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const payload = apiPost.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.teacherId).toBeUndefined();
    expect((payload.items as Array<Record<string, unknown>>)[0].teacherId).toBeUndefined();
  });
});

describe("PresencesPage — PERF-PR3 présences du jour par classe", () => {
  const CLASS_A = "aaaaaaaa-0000-4000-8000-00000000000a";
  const CLASS_B = "bbbbbbbb-0000-4000-8000-00000000000b";
  const now = new Date();
  const isoToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const getMock = () => vi.mocked(api.get);
  const presenceCalls = () =>
    getMock()
      .mock.calls.map(([path]) => new URL(`http://test${String(path)}`))
      .filter((url) => url.pathname === "/v2/presences");
  const defaultGet = vi.mocked(api.get).getMockImplementation();

  beforeEach(() => {
    if (defaultGet) getMock().mockImplementation(defaultGet);
    showToast.mockReset();
    apiPost.mockReset();
    classStudentsList.mockReset();
    getMock().mockClear();
    authSession.user = { id: "admin-1", role: "Admin School", schoolCode: "SCH-001", name: "Admin" };
    dataState.classes = [
      { id: CLASS_A, classId: CLASS_A, classCode: "CLS-A", name: "6ème A", students: 2 },
      { id: CLASS_B, classId: CLASS_B, classCode: "CLS-B", name: "6ème B", students: 1 },
    ];
    dataState.assignments = [];
    dataState.teachers = [];
    dataState.students = [
      { id: "ELE-1", matricule: "ELE-1", classId: CLASS_A, classCode: "CLS-A" },
      { id: "ELE-2", matricule: "ELE-2", classId: CLASS_A, classCode: "CLS-A" },
      { id: "ELE-3", matricule: "ELE-3", classId: CLASS_B, classCode: "CLS-B" },
    ];
    dataState.presences = [
      { id: "p-1", studentId: "ELE-1", classId: CLASS_A, classCode: "CLS-A", date: isoToday, status: "Absent", present: false },
      { id: "p-3", studentId: "ELE-3", classId: CLASS_B, classCode: "CLS-B", date: isoToday, status: "Présent", present: true },
    ];
    classStudentsList.mockResolvedValue([
      { id: "ELE-1", matricule: "ELE-1", name: "Awa Diop", classId: CLASS_A, classCode: "CLS-A" },
      { id: "ELE-2", matricule: "ELE-2", name: "Bintou Sow", classId: CLASS_A, classCode: "CLS-A" },
    ]);
  });

  it("cartes : une lecture par classe (filtre classId), jamais toute la journée de l'établissement", async () => {
    render(<RoutedPresencesPage />);
    const cards = await screen.findAllByRole("button");
    const cardA = cards.find((node) => node.textContent?.includes("6ème A")) as HTMLElement;
    const cardB = cards.find((node) => node.textContent?.includes("6ème B")) as HTMLElement;
    await waitFor(() => expect(cardB.textContent).toMatch(/Présence 100 %/));
    // Classe A : 1 élève sur 2 saisi → appel incomplet, pas un taux faussé.
    await waitFor(() => expect(cardA.textContent).not.toMatch(/chargement/));
    expect(cardA.textContent).not.toMatch(/Présence 100 %/);
    const calls = presenceCalls();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const url of calls) {
      expect(url.searchParams.get("date")).toBe(isoToday);
      expect([CLASS_A, CLASS_B]).toContain(url.searchParams.get("classId"));
    }
  });

  it("classe ouverte : registre complet, « Présent » par défaut pour l'élève sans enregistrement", async () => {
    const user = userEvent.setup();
    render(<RoutedPresencesPage />);
    const cardA = (await screen.findAllByRole("button")).find((node) => node.textContent?.includes("6ème A")) as HTMLElement;
    await user.click(cardA);
    expect(await screen.findByText("Bintou Sow")).toBeInTheDocument();
    const rows = screen.getAllByTestId("presence-student-row");
    const statusOf = (studentId: string) =>
      rows.find((row) => row.getAttribute("data-student-id") === studentId)?.querySelector(".print-only")?.textContent;
    await waitFor(() => expect(statusOf("ELE-1")).toBe("Absent"));
    expect(statusOf("ELE-2")).toBe("Présent");
    expect(rows).toHaveLength(2);
  });

  it("tant que la classe n'est pas lue en entier, l'appel n'est pas enregistrable", async () => {
    getMock().mockImplementation(async (path: string) => {
      const url = new URL(`http://test${path}`);
      if (url.searchParams.get("classId") === CLASS_A) return new Promise(() => undefined);
      return { items: [], nextCursor: null, hasMore: false };
    });
    const user = userEvent.setup();
    render(<RoutedPresencesPage />);
    const cardA = (await screen.findAllByRole("button")).find((node) => node.textContent?.includes("6ème A")) as HTMLElement;
    await user.click(cardA);
    expect(await screen.findByText("Chargement des présences de la classe…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer l'appel" })).toBeDisabled();
    expect(apiPost).not.toHaveBeenCalled();
  });
});
