import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PresencesPage } from "./PresencesPage";
import { readFileSync } from "node:fs";
import path from "node:path";

const showToast = vi.hoisted(() => vi.fn());
const classStudentsList = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

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
    session: {
      user: { id: "admin-1", role: "Admin School", schoolCode: "SCH-001", name: "Admin" },
    },
  }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    scopedUser: { id: "admin-1", role: "Admin School", schoolCode: "SCH-001", name: "Admin" },
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
});
