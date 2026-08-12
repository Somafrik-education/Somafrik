import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
}));

const apiState = vi.hoisted(() => ({
  classCode: "CLS-SCH-A-1",
  className: "6ème A",
  students: [
    {
      id: "ELE-SCH-A-000001",
      publicId: "ELE-SCH-A-000001",
      studentCode: "ELE-SCH-A-000001",
      matricule: "ELE-SCH-A-000001",
      firstName: "Awa",
      lastName: "Diop",
      name: "Awa Diop",
      gender: "Féminin",
      className: "6ème A",
      classCode: "CLS-SCH-A-1",
      schoolCode: "SCH-001",
      status: "active",
      enrollmentId: "enr-1",
      enrollmentDate: "12-08-2026",
      academicYearName: "2025-2026",
      birthDate: "",
      parentPhone: "",
      parentEmail: "",
    },
  ] as Array<Record<string, unknown>>,
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "u1",
        role: "Admin School",
        schoolCode: "SCH-001",
        name: "Admin",
      },
    },
  }),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    activeSchoolCode: "SCH-001",
    scopedUser: {
      id: "u1",
      role: "Admin School",
      schoolCode: "SCH-001",
      name: "Admin",
    },
  }),
}));

vi.mock("../../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({ user: { role: "Admin School", schoolCode: "SCH-001" } }),
}));

vi.mock("../../lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/permissions")>();
  return {
    ...actual,
    getEntityFeaturePermissions: () => ({ ...permissions }),
  };
});

vi.mock("../../lib/classesApi", () => ({
  classesApi: {
    list: vi.fn(async () => [
      {
        classCode: apiState.classCode,
        name: apiState.className,
        status: "active",
        academicYearName: "2025-2026",
        schoolCode: "SCH-001",
      },
    ]),
  },
}));

vi.mock("../../lib/classStudentsApi", () => ({
  classStudentsApi: {
    list: vi.fn(async () => apiState.students),
    enroll: vi.fn(async (_classCode: string, payload: Record<string, string>) => ({
      id: "ELE-SCH-A-000002",
      publicId: "ELE-SCH-A-000002",
      studentCode: "ELE-SCH-A-000002",
      matricule: "ELE-SCH-A-000002",
      firstName: payload.firstName,
      lastName: payload.lastName,
      name: `${payload.firstName} ${payload.lastName}`,
      gender: payload.gender ?? "",
      className: apiState.className,
      classCode: apiState.classCode,
      schoolCode: "SCH-001",
      status: "active",
      enrollmentId: "enr-2",
      enrollmentDate: "12-08-2026",
      academicYearName: "2025-2026",
      birthDate: "",
      parentPhone: "",
      parentEmail: "",
    })),
  },
}));

vi.mock("../../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { ClassStudentsPage } from "./ClassStudentsPage";
import { classStudentsApi } from "../../lib/classStudentsApi";

function renderPage(classCode = "CLS-SCH-A-1") {
  const encoded = encodeURIComponent(classCode);
  return render(
    <MemoryRouter initialEntries={[`/etablissement/classes/${encoded}/eleves`]}>
      <Routes>
        <Route path="/etablissement/classes" element={<div>Liste classes</div>} />
        <Route path="/etablissement/classes/:classCode/eleves" element={<ClassStudentsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ClassStudentsPage — inscription depuis une classe", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    apiState.students = [
      {
        id: "ELE-SCH-A-000001",
        publicId: "ELE-SCH-A-000001",
        studentCode: "ELE-SCH-A-000001",
        matricule: "ELE-SCH-A-000001",
        firstName: "Awa",
        lastName: "Diop",
        name: "Awa Diop",
        gender: "Féminin",
        className: "6ème A",
        classCode: "CLS-SCH-A-1",
        schoolCode: "SCH-001",
        status: "active",
        enrollmentId: "enr-1",
        enrollmentDate: "12-08-2026",
        academicYearName: "2025-2026",
        birthDate: "",
        parentPhone: "",
        parentEmail: "",
      },
    ];
    vi.clearAllMocks();
  });

  it("affiche les élèves de la classe via l'API PostgreSQL", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 2, name: "Élèves — 6ème A" })).toBeInTheDocument();
    const list = screen.getByLabelText("Liste");
    expect(within(list).getByText("Diop")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inscrire un élève" })).toBeInTheDocument();
  });

  it("inscrit un élève sans exposer de champ classCode", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: "Inscrire un élève" });
    await user.click(screen.getByRole("button", { name: "Inscrire un élève" }));

    expect(screen.getByText(/CLS-SCH-A-1/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/classCode/i)).not.toBeInTheDocument();

    await user.type(document.getElementById("enroll-first-name")!, "Ibra");
    await user.type(document.getElementById("enroll-last-name")!, "Fall");
    await user.click(screen.getByRole("button", { name: "Inscrire" }));

    await waitFor(() => {
      expect(classStudentsApi.enroll).toHaveBeenCalledWith("CLS-SCH-A-1", {
        firstName: "Ibra",
        lastName: "Fall",
        gender: undefined,
        birthDate: undefined,
        parentPhone: undefined,
        parentEmail: undefined,
      });
    });
  });

  it("redirige vers la liste Classes si classCode vide", () => {
    render(
      <MemoryRouter initialEntries={["/etablissement/classes/%20/eleves"]}>
        <Routes>
          <Route path="/etablissement/classes" element={<div>Liste classes</div>} />
          <Route path="/etablissement/classes/:classCode/eleves" element={<ClassStudentsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Liste classes")).toBeInTheDocument();
  });
});
