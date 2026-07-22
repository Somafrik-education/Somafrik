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
  academicYearLabel: "2025-2026",
  schoolNameLabel: "Lycée Test",
  alerts: [],
  genderLabel: "F",
  ageLabel: "12 ans",
  birthDateLabel: "01/01/2014",
  phoneLabel: "—",
  nationalityLabel: "SN",
  enrollmentDateLabel: "01/09/2025",
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

vi.mock("../../hooks/useStudentWorkspace", () => ({
  useStudentWorkspace: () => ({
    workspace,
    loading: false,
    error: null,
  }),
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
  });

  it("renders RecordLayout with student header", () => {
    render(
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

    expect(screen.getByRole("heading", { name: "Awa Diop" })).toBeInTheDocument();
    expect(screen.getByText(/Matricule : MAT-001/)).toBeInTheDocument();
    expect(screen.getByLabelText("Contenu")).toBeInTheDocument();
    expect(screen.getByTestId("tabs")).toBeInTheDocument();
  });
});
