import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PresencesPage } from "./PresencesPage";

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
      id: "uuid-a",
      classId: "uuid-a",
      classCode: "CLS-A",
      name: "2ème A",
      students: 1,
    },
    {
      id: "uuid-b",
      classId: "uuid-b",
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
    get: vi.fn(),
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
      { id: "uuid-a", classId: "uuid-a", classCode: "CLS-A", name: "2ème A", students: 1 },
      { id: "uuid-b", classId: "uuid-b", classCode: "CLS-B", name: "2ème A", students: 0 },
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
        classId: "uuid-a",
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

  it("PARITY-057 — lignes A/B/D ne complètent pas le roster A/B/C", async () => {
    const now = new Date();
    const isoToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    dataState.classes = [{ id: "uuid-a", classId: "uuid-a", classCode: "CLS-A", name: "6ème A", students: 3 }];
    dataState.students = [
      { id: "A", matricule: "A", classId: "uuid-a", classCode: "CLS-A" },
      { id: "B", matricule: "B", classId: "uuid-a", classCode: "CLS-A" },
      { id: "C", matricule: "C", classId: "uuid-a", classCode: "CLS-A" },
    ];
    dataState.presences = [
      { studentId: "A", classId: "uuid-a", classCode: "CLS-A", date: isoToday, status: "Présent", present: true },
      { studentId: "B", classId: "uuid-a", classCode: "CLS-A", date: isoToday, status: "Présent", present: true },
      { studentId: "D", classId: "uuid-a", classCode: "CLS-A", date: isoToday, status: "Présent", present: true },
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

  it("ouverture directe : compteur 0, 6 élèves canoniques et appel complet → 6 et Présence N %", async () => {
    const now = new Date();
    const isoToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const students = Array.from({ length: 6 }, (_, index) => ({
      id: `STU-${index + 1}`,
      matricule: `STU-${index + 1}`,
      classId: "uuid-1pa",
      classCode: "CLS-1PA",
      className: "1ère Primaire A",
      schoolCode: "SCH-001",
      status: "ENROLLED",
    }));
    dataState.classes = [
      { id: "uuid-1pa", classId: "uuid-1pa", classCode: "CLS-1PA", name: "1ère Primaire A", students: 0 },
      { id: "uuid-1pb", classId: "uuid-1pb", classCode: "CLS-1PB", name: "1ère Primaire A", students: 0 },
    ];
    dataState.students = [
      ...students,
      {
        id: "STU-FOREIGN",
        matricule: "STU-FOREIGN",
        classId: "uuid-foreign",
        classCode: "CLS-FOREIGN",
        className: "1ère Primaire A",
        schoolCode: "SCH-OTHER",
        status: "ENROLLED",
      },
    ];
    dataState.presences = students.map((student, index) => ({
      studentId: student.id,
      classId: "uuid-1pa",
      classCode: "CLS-1PA",
      date: isoToday,
      status: index === 0 ? "Absent" : "Présent",
      present: index !== 0,
    }));
    dataState.presences.push({
      studentId: "GHOST",
      classId: "uuid-1pb",
      classCode: "CLS-1PB",
      date: isoToday,
      status: "Présent",
      present: true,
    });

    render(<RoutedPresencesPage />);
    const cards = await screen.findAllByRole("button");
    const primaire = cards.filter((node) => node.textContent?.includes("1ère Primaire A"));
    expect(primaire).toHaveLength(2);
    const filled = primaire.find((node) => node.textContent?.includes("6 élève"));
    const empty = primaire.find((node) => node.textContent?.includes("0 élève"));
    expect(filled?.textContent).toMatch(/Présence 83 %/);
    expect(filled?.textContent).not.toMatch(/Présence —/);
    expect(empty?.textContent).toMatch(/Présence —/);
    expect(empty?.textContent).not.toMatch(/6 élève/);
  });

  it("ouverture directe : appel complet tous absents → Présence 0 %", async () => {
    const now = new Date();
    const isoToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const students = Array.from({ length: 6 }, (_, index) => ({
      id: `ABS-${index + 1}`,
      matricule: `ABS-${index + 1}`,
      classId: "uuid-1pa",
      classCode: "CLS-1PA",
      schoolCode: "SCH-001",
      status: "ENROLLED",
    }));
    dataState.classes = [
      { id: "uuid-1pa", classId: "uuid-1pa", classCode: "CLS-1PA", name: "1ère Primaire A", students: 0 },
    ];
    dataState.students = students;
    dataState.presences = students.map((student) => ({
      studentId: student.id,
      classId: "uuid-1pa",
      classCode: "CLS-1PA",
      date: isoToday,
      status: "Absent",
      present: false,
    }));

    render(<RoutedPresencesPage />);
    const card = (await screen.findAllByRole("button")).find((node) => node.textContent?.includes("1ère Primaire A"));
    expect(card?.textContent).toMatch(/6 élève/);
    expect(card?.textContent).toMatch(/Présence 0 %/);
    expect(card?.textContent).not.toMatch(/Présence —/);
  });

  it("H — enseignant Seke-like : JWT 2 assignments, state.assignments vide → 2 cartes", async () => {
    authSession.user = {
      id: "user-seke",
      role: "Enseignant",
      schoolCode: "SCH-001",
      assignments: [
        { classId: "uuid-a", classCode: "CLS-A", status: "active" },
        { classId: "uuid-b", classCode: "CLS-B", status: "active" },
      ],
      assignedClassIds: ["uuid-a", "uuid-b"],
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
      { id: "uuid-a", classId: "uuid-a", classCode: "CLS-A", name: "2ème A", students: 1 },
      { id: "uuid-b", classId: "uuid-b", classCode: "CLS-B", name: "2ème A", students: 0 },
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
        classId: "uuid-a",
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
        classId: "uuid-a",
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
      assignments: [{ classId: "uuid-a", classCode: "CLS-A", status: "active" }],
      assignedClassIds: ["uuid-a"],
      assignedClassCodes: ["CLS-A"],
    };
    dataState.assignments = [
      { teacherId: "ENS-OTHER", classId: "uuid-a", classCode: "CLS-A", status: "active" },
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
