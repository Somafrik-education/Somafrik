import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const workspace = {
  studentId: "stu-1",
  displayName: "Awa Diop",
  matriculeLabel: "MAT-001",
  isActive: true,
  activeStatusLabel: "Actif",
  enrollmentStatusLabel: "Inscrit",
  classLabel: "6ème A",
  academicYearLabel: "2026-2027",
  schoolNameLabel: "Lycée Test",
  alerts: [],
  genderLabel: "F",
  ageLabel: "12 ans",
  birthDateLabel: "01/01/2014",
  phoneLabel: "—",
  nationalityLabel: "SN",
  enrollmentDateLabel: "01/09/2026",
  guardiansCountLabel: "2",
  primaryGuardianLabel: "M. Diop",
  documentsCompleteLabel: "Complet",
  documentsMissingLabel: "0",
  medicalAlertLabel: "Aucune",
  financialResponsibles: [],
  primaryGuardian: null,
  guardians: [],
  emergencyContacts: [],
  pickupAuthorizations: [],
};

const useStudentWorkspaceMock = vi.hoisted(() => vi.fn());
const useStudentEditingContextMock = vi.hoisted(() => vi.fn());

vi.mock("../../hooks/useStudentWorkspace", () => ({
  useStudentWorkspace: (...args: unknown[]) => useStudentWorkspaceMock(...args),
}));

vi.mock("../../hooks/useStudentEditingContext", () => ({
  useStudentEditingContext: (...args: unknown[]) =>
    useStudentEditingContextMock(...args),
}));

vi.mock("../../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({ user: { role: "Admin School" } }),
}));

vi.mock("../../lib/studentWorkspacePermissions", () => ({
  canReadStudentWorkspaceModule: () => true,
  filterAccessibleStudentWorkspaceModules: (modules: unknown) => modules,
}));

vi.mock("../../components/students/StudentWorkspaceTabs", () => ({
  StudentWorkspaceTabs: () => <div data-testid="tabs">Tabs</div>,
}));

import { StudentWorkspacePage } from "./StudentWorkspacePage";

describe("StudentWorkspacePage (D3.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStudentWorkspaceMock.mockReturnValue({
      workspace,
      loading: false,
      error: null,
    });
    useStudentEditingContextMock.mockReturnValue({
      enrollmentRecords: [],
    });
  });

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={["/etablissement/eleves/stu-1"]}>
        <Routes>
          <Route path="/etablissement/eleves/:studentId" element={<StudentWorkspacePage />} />
          <Route
            path="/etablissement/eleves/:studentId/:section"
            element={<StudentWorkspacePage />}
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("renders RecordLayout with student header from the canonical workspace", () => {
    renderPage();

    expect(useStudentWorkspaceMock).toHaveBeenCalledWith("stu-1", {
      enrollmentOverride: undefined,
    });
    expect(screen.getByRole("heading", { name: "Awa Diop" })).toBeInTheDocument();
    expect(screen.getByText(/Matricule : MAT-001/)).toBeInTheDocument();
    expect(screen.getByText("2026-2027")).toBeInTheDocument();
    expect(screen.getByText("Lycée Test")).toBeInTheDocument();
    expect(screen.getByLabelText("Contenu")).toBeInTheDocument();
    expect(screen.getByTestId("tabs")).toBeInTheDocument();
  });

  it("does not overlay a MIGRATION fallback onto the canonical dossier", () => {
    useStudentEditingContextMock.mockReturnValue({
      enrollmentRecords: [{ source: "MIGRATION" }],
    });

    renderPage();

    expect(useStudentWorkspaceMock).toHaveBeenCalledWith("stu-1", {
      enrollmentOverride: undefined,
    });
  });

  it("overlays a C1.8 school-administration enrollment after local mutation", () => {
    const enrollmentRecords = [{ source: "SCHOOL_ADMINISTRATION" }];
    useStudentEditingContextMock.mockReturnValue({ enrollmentRecords });

    renderPage();

    expect(useStudentWorkspaceMock).toHaveBeenCalledWith("stu-1", {
      enrollmentOverride: enrollmentRecords,
    });
  });
});
