/**
 * DEEPLINK-PRESENCE — `/presences?attendanceId=…` doit positionner l'appel sur
 * la classe de la présence visée et mettre en évidence l'élève concerné.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PresencesPage } from "./PresencesPage";

const showToast = vi.hoisted(() => vi.fn());
const classStudentsList = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

const authSession = vi.hoisted(() => ({
  user: { id: "admin-1", role: "Admin School", schoolCode: "SCH-001", name: "Admin" } as Record<string, unknown>,
}));

const dataState = vi.hoisted(() => ({
  classes: [
    { id: "uuid-a", classId: "uuid-a", classCode: "CLS-A", name: "6ème A", students: 2 },
    { id: "uuid-b", classId: "uuid-b", classCode: "CLS-B", name: "5ème B", students: 1 },
  ],
  assignments: [] as Record<string, unknown>[],
  teachers: [] as Record<string, unknown>[],
  presences: [] as Record<string, unknown>[],
}));

vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ session: authSession }) }));
vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({ scopedUser: authSession.user }),
}));
vi.mock("../context/DataContext", () => ({
  useData: () => ({ state: dataState, refresh, update: vi.fn() }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({ user: { role: "Admin School", schoolCode: "SCH-001" } }),
  useFeaturePermissions: () => ({ canRead: true, canUpdate: true }),
}));

vi.mock("../lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/permissions")>();
  return { ...actual, canManagePresences: () => true };
});

vi.mock("../components/ui/Toast", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../lib/classStudentsApi", () => ({ classStudentsApi: { list: classStudentsList } }));
vi.mock("../api/client", () => ({ api: { post: vi.fn(), get: vi.fn() } }));

function renderPage(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/presences${search}`]}>
      <PresencesPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dataState.presences = [
    {
      id: "att-1",
      studentId: "ELE-1",
      classId: "uuid-a",
      classCode: "CLS-A",
      date: "2026-09-01",
      status: "Absent",
      present: false,
    },
    {
      id: "att-2",
      studentId: "ELE-2",
      classId: "uuid-a",
      classCode: "CLS-A",
      date: "2026-09-01",
      status: "Présent",
      present: true,
    },
  ];
  classStudentsList.mockResolvedValue([
    { id: "ELE-1", publicId: "ELE-1", matricule: "ELE-1", name: "Awa Diop", classId: "uuid-a", classCode: "CLS-A" },
    { id: "ELE-2", publicId: "ELE-2", matricule: "ELE-2", name: "Binta Traoré", classId: "uuid-a", classCode: "CLS-A" },
  ]);
});

describe("DEEPLINK-PRESENCE — la page Présences consomme attendanceId", () => {
  it("DEEPLINK-PRESENCE-01 — la classe de la présence est ouverte et l'élève mis en évidence", async () => {
    renderPage("?attendanceId=att-1");

    await waitFor(() => expect(classStudentsList).toHaveBeenCalledWith("CLS-A"));
    const rows = await screen.findAllByTestId("presence-student-row");
    const selected = rows.filter((row) => row.getAttribute("data-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAttribute("data-student-id", "ELE-1");
    expect(selected[0]).toHaveTextContent("Awa Diop");
  });

  it("DEEPLINK-PRESENCE-02 — sans paramètre, aucune classe n'est ouverte d'office", async () => {
    renderPage("");
    await screen.findAllByRole("button");
    expect(classStudentsList).not.toHaveBeenCalled();
    expect(screen.queryByTestId("presence-student-row")).toBeNull();
  });

  it("DEEPLINK-PRESENCE-03 — une présence hors périmètre n'ouvre aucune classe", async () => {
    renderPage("?attendanceId=att-autre-ecole");
    await screen.findAllByRole("button");
    expect(classStudentsList).not.toHaveBeenCalled();
    expect(screen.queryByTestId("presence-student-row")).toBeNull();
  });
});
