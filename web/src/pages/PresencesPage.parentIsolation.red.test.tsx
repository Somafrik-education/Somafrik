/**
 * P0 Parent Attendance Isolation — RED UI.
 *
 * Contrat Parent :
 * - pas de « Changer de classe » ;
 * - pas de KPI globaux de classe ;
 * - jamais le roster des camarades ;
 * - seulement « Mes enfants → présence de l'enfant » ;
 * - plusieurs enfants : sélecteur d'enfant, pas sélecteur de classe.
 *
 * Le filtrage UI n'est pas la sécurité. Ce fichier prouve que l'écran actuel
 * est encore un appel de classe, identique à la capture préprod.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PresencesPage } from "./PresencesPage";
import { readFileSync } from "node:fs";
import path from "node:path";

const showToast = vi.hoisted(() => vi.fn());
const classStudentsList = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

const authSession = vi.hoisted(() => ({
  user: {
    id: "parent-maeva",
    role: "Parent",
    schoolCode: "CD-LAC-26-001",
    name: "Papa Maeve",
    studentIds: ["STU-MAEVA"],
    children: [{ id: "STU-MAEVA", firstName: "Maeva", lastName: "A", name: "Maeva A" }],
  } as Record<string, unknown>,
}));

const dataState = vi.hoisted(() => ({
  classes: [
    { id: "uuid-a", classId: "uuid-a", classCode: "CLS-2A", name: "2ème A", students: 4 },
    { id: "uuid-b", classId: "uuid-b", classCode: "CLS-2B", name: "2ème B", students: 28 },
  ],
  assignments: [] as Record<string, unknown>[],
  teachers: [] as Record<string, unknown>[],
  presences: [
    { id: "att-maeva", studentId: "STU-MAEVA", classCode: "CLS-2A", classId: "uuid-a", status: "Présent", date: "09-09-2026" },
    { id: "att-aisha", studentId: "STU-AISHA", classCode: "CLS-2A", classId: "uuid-a", status: "Absent", date: "09-09-2026" },
    { id: "att-jean", studentId: "STU-JEAN", classCode: "CLS-2A", classId: "uuid-a", status: "Retard", date: "09-09-2026" },
    { id: "att-luc", studentId: "STU-LUC", classCode: "CLS-2A", classId: "uuid-a", status: "Présent", date: "09-09-2026" },
  ],
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ session: authSession }),
}));
vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({ scopedUser: authSession.user }),
}));
vi.mock("../context/DataContext", () => ({
  useData: () => ({ state: dataState, refresh, update: vi.fn() }),
}));
vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({ user: { role: "Parent", schoolCode: "CD-LAC-26-001" } }),
  useFeaturePermissions: () => ({ canRead: true, canUpdate: false }),
}));
vi.mock("../lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/permissions")>();
  return { ...actual, canManagePresences: () => false };
});
vi.mock("../components/ui/Toast", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../lib/classStudentsApi", () => ({
  classStudentsApi: { list: classStudentsList },
}));
vi.mock("../api/client", () => ({
  api: { post: vi.fn(), get: vi.fn() },
}));

function renderParentPresences(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/presences${search}`]}>
      <PresencesPage />
    </MemoryRouter>,
  );
}

const CLASSMATES = [
  { id: "STU-MAEVA", studentCode: "STU-MAEVA", matricule: "STU-MAEVA", firstName: "Maeva", lastName: "A", name: "Maeva A", classCode: "CLS-2A" },
  { id: "STU-AISHA", studentCode: "STU-AISHA", matricule: "STU-AISHA", firstName: "Aisha", lastName: "B", name: "Aisha B", classCode: "CLS-2A" },
  { id: "STU-JEAN", studentCode: "STU-JEAN", matricule: "STU-JEAN", firstName: "Jean", lastName: "C", name: "Jean C", classCode: "CLS-2A" },
  { id: "STU-LUC", studentCode: "STU-LUC", matricule: "STU-LUC", firstName: "Luc", lastName: "D", name: "Luc D", classCode: "CLS-2A" },
];

describe("P0 UI Parent — isolation présences", () => {
  beforeEach(() => {
    showToast.mockReset();
    refresh.mockReset();
    classStudentsList.mockReset();
    classStudentsList.mockResolvedValue(CLASSMATES);
    authSession.user = {
      id: "parent-maeva",
      role: "Parent",
      schoolCode: "CD-LAC-26-001",
      name: "Papa Maeve",
      studentIds: ["STU-MAEVA"],
      children: [{ id: "STU-MAEVA", firstName: "Maeva", lastName: "A", name: "Maeva A" }],
    };
  });

  it("n'affiche pas un sélecteur de classes de l'établissement", () => {
    renderParentPresences();
    expect(screen.queryByText("2ème B")).not.toBeInTheDocument();
    expect(screen.queryByText(/28 élève/)).not.toBeInTheDocument();
    expect(screen.queryByText(/4 élève/)).not.toBeInTheDocument();
    expect(screen.getByText(/Mes enfants/i)).toBeInTheDocument();
  });

  it("n'affiche ni Changer de classe, ni KPI de classe, ni camarades", async () => {
    const user = userEvent.setup();
    renderParentPresences();
    const classCard = screen.queryByRole("button", { name: /2ème A/i });
    if (classCard) {
      await user.click(classCard);
    }
    await waitFor(() => {
      expect(screen.queryByText("Chargement du roster…")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Changer de classe" })).not.toBeInTheDocument();
    expect(screen.queryByText("Taux de présence")).not.toBeInTheDocument();
    expect(screen.queryByText("Tous présents")).not.toBeInTheDocument();
    expect(screen.queryByText("Aisha B")).not.toBeInTheDocument();
    expect(screen.queryByText("Jean C")).not.toBeInTheDocument();
    expect(screen.queryByText("Luc D")).not.toBeInTheDocument();
    expect(screen.getByText(/Maeva/i)).toBeInTheDocument();
  });

  it("attendanceId d'un autre enfant ne révèle pas son statut", async () => {
    renderParentPresences("?attendanceId=att-aisha");
    await waitFor(() => {
      expect(classStudentsList.mock.calls.length >= 0).toBe(true);
    });
    expect(screen.queryByText("Aisha B")).not.toBeInTheDocument();
    expect(screen.queryByText("Absent")).not.toBeInTheDocument();
  });

  it("le source Parent n'est plus un écran d'appel unique", () => {
    const source = readFileSync(path.join(__dirname, "PresencesPage.tsx"), "utf8");
    expect(source).toMatch(/Mes enfants/);
    expect(source).toMatch(/role === ["']Parent["']/);
  });
});
