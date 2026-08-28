import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PresencesPage } from "./PresencesPage";
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
  assignments: [],
  teachers: [],
  presences: [],
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
    dataState.assignments = [];
    dataState.teachers = [];
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
    render(<PresencesPage />);
    const cards = await screen.findAllByRole("button");
    const secondA = cards.filter((node) => node.textContent?.includes("2ème A"));
    expect(secondA).toHaveLength(2);
    expect(secondA[0].textContent).toMatch(/1 élève/);
    expect(secondA[1].textContent).toMatch(/0 élève/);
  });

  it("charge le roster via GET /classes/:classCode/students (cas A className vide)", async () => {
    const user = userEvent.setup();
    render(<PresencesPage />);
    const cards = await screen.findAllByRole("button");
    const classA = cards.find((node) => node.textContent?.includes("1 élève")) as HTMLElement;
    await user.click(classA);
    await waitFor(() => {
      expect(classStudentsList).toHaveBeenCalledWith("CLS-A");
    });
    expect(await screen.findByText("Awa Diop")).toBeInTheDocument();
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
        { classId: "uuid-a", classCode: "CLS-A", status: "active" },
        { classId: "uuid-b", classCode: "CLS-B", status: "active" },
      ],
      assignedClassIds: ["uuid-a", "uuid-b"],
      assignedClassCodes: ["CLS-A", "CLS-B"],
    };
    dataState.assignments = [];
    dataState.teachers = [];
    render(<PresencesPage />);
    const cards = await screen.findAllByRole("button");
    const classCards = cards.filter((node) => node.textContent?.includes("2ème A"));
    expect(classCards).toHaveLength(2);
    expect(screen.queryByText("Aucune classe dans votre périmètre.")).not.toBeInTheDocument();
  });
});

describe("PresencesPage — enseignant pédagogique ≠ acteur JWT", () => {
  async function openClassWithRoster() {
    const user = userEvent.setup();
    render(<PresencesPage />);
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
