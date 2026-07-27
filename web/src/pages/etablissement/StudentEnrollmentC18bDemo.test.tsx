/**
 * Démo fonctionnelle C1.8b — transfert / clôture.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { resetStudentEditingSessionsForTests } from "../../hooks/useStudentEditingContext";
import { StudentWorkspacePage } from "./StudentWorkspacePage";

const { SCHOOL, STUDENT_ID, ENROLLMENT_ID, dataState } = vi.hoisted(() => {
  const SCHOOL = "CD-2026-0001";
  const STUDENT_ID = "stu-c18b-demo";
  const ENROLLMENT_ID = "enr-c18b-demo";
  const dataState = {
    current: {
      schools: [{ code: SCHOOL, name: "Collège Démo C1.8b" }],
      classes: [{ id: "CLS-4A", name: "4e A", schoolCode: SCHOOL }],
      students: [
        {
          id: STUDENT_ID,
          matricule: "M-C18B",
          firstName: "Noah",
          lastName: "Mbala",
          name: "Mbala",
          schoolCode: SCHOOL,
          schoolYear: "2026-2027",
          schoolStatus: "Inscrit",
        },
      ],
      studentEnrollments: [
        {
          id: ENROLLMENT_ID,
          studentId: STUDENT_ID,
          schoolCode: SCHOOL,
          academicYear: "2026-2027",
          status: "ENROLLED",
          source: "SCHOOL_ADMINISTRATION",
          classId: "CLS-4A",
          className: "4e A",
          requestedAt: "2026-05-01",
          validatedAt: "2026-07-20",
          enrolledAt: "2026-07-21",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-07-21T00:00:00.000Z",
        },
      ],
      persons: [],
      guardians: [],
      studentGuardianRelations: [],
      studentDocuments: [],
      studentMedicalProfiles: [],
      teachers: [],
      assignments: [],
      courses: [],
      contacts: [],
      relations: [],
      users: [],
      academicConfigBySchool: {},
      auditLog: [],
      rolePermissions: {
        Secrétaire: [
          "Élèves:READ",
          "student.enrollments.transfer",
          "student.enrollments.close",
        ],
      },
    } as Record<string, unknown>,
  };
  return { SCHOOL, STUDENT_ID, ENROLLMENT_ID, dataState };
});

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "u-secretaire",
        role: "Secrétaire",
        schoolCode: SCHOOL,
        identifier: "secretaire@demo.local",
        permissions: [
          "Élèves:READ",
          "student.enrollments.transfer",
          "student.enrollments.close",
        ],
      },
      permissions: [
        "Élèves:READ",
        "student.enrollments.transfer",
        "student.enrollments.close",
      ],
    },
  }),
}));

vi.mock("../../context/DataContext", () => ({
  useData: () => ({
    state: dataState.current,
    loading: false,
    error: null,
    update: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    activeSchoolCode: SCHOOL,
    scopedUser: {
      id: "u-secretaire",
      role: "Secrétaire",
      schoolCode: SCHOOL,
      name: "Secrétaire Démo",
    },
  }),
}));

function renderWorkspace(section = "inscription") {
  return render(
    <MemoryRouter
      initialEntries={[`/etablissement/eleves/${STUDENT_ID}/${section}`]}
    >
      <Routes>
        <Route
          path="/etablissement/eleves/:studentId"
          element={<StudentWorkspacePage />}
        />
        <Route
          path="/etablissement/eleves/:studentId/:section"
          element={<StudentWorkspacePage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const PREEXISTING_NOTES = "Note métier préexistante C1.8b";

function resetEnrolled() {
  dataState.current.studentEnrollments = [
    {
      id: ENROLLMENT_ID,
      studentId: STUDENT_ID,
      schoolCode: SCHOOL,
      academicYear: "2026-2027",
      status: "ENROLLED",
      source: "SCHOOL_ADMINISTRATION",
      classId: "CLS-4A",
      className: "4e A",
      requestedAt: "2026-05-01",
      validatedAt: "2026-07-20",
      enrolledAt: "2026-07-21",
      endedAt: null,
      transferDate: null,
      destinationSchoolName: null,
      closureDate: null,
      notes: PREEXISTING_NOTES,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
    },
  ];
}

describe("C1.8b démo — transfer / close enrollment", () => {
  beforeEach(() => {
    cleanup();
    resetStudentEditingSessionsForTests();
    resetEnrolled();
  });

  it("clôture ENROLLED → CLOSED avec historique et remount", async () => {
    const user = userEvent.setup();
    renderWorkspace("inscription");

    const tab = await screen.findByTestId("student-enrollment-tab");
    expect(within(tab).getAllByText("Inscrit").length).toBeGreaterThan(0);

    await user.click(screen.getByTestId("enrollment-close-start"));
    fireEvent.change(screen.getByTestId("enrollment-close-date"), {
      target: { value: "2026-07-23" },
    });
    fireEvent.change(screen.getByTestId("enrollment-close-reason"), {
      target: { value: "Depart volontaire" },
    });
    await user.click(screen.getByTestId("enrollment-close-confirm"));

    const alert = screen.queryByRole("alert");
    if (alert) {
      throw new Error(`Clôture refusée: ${alert.textContent}`);
    }

    expect(await within(tab).findAllByText("Clôturé")).not.toHaveLength(0);
    expect(within(tab).getAllByText("4e A").length).toBeGreaterThan(0);

    cleanup();
    renderWorkspace("historique");
    const history = await screen.findByTestId("student-history-tab");
    expect(
      within(history).getAllByText("Clôture d'inscription").length,
    ).toBeGreaterThan(0);

    cleanup();
    renderWorkspace("inscription");
    const reopened = await screen.findByTestId("student-enrollment-tab");
    expect(within(reopened).getAllByText("Clôturé").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("enrollment-close-start")).not.toBeInTheDocument();
    expect(screen.queryByTestId("enrollment-transfer-start")).not.toBeInTheDocument();
    expect(screen.queryByTestId("enrollment-validate-start")).not.toBeInTheDocument();
    expect(screen.queryByTestId("enrollment-assign-confirm")).not.toBeInTheDocument();
  });

  it("transfert ENROLLED → TRANSFERRED avec destination en historique et remount", async () => {
    const user = userEvent.setup();
    renderWorkspace("inscription");

    const tab = await screen.findByTestId("student-enrollment-tab");
    await user.click(screen.getByTestId("enrollment-transfer-start"));
    fireEvent.change(screen.getByTestId("enrollment-transfer-date"), {
      target: { value: "2026-07-23" },
    });
    fireEvent.change(screen.getByTestId("enrollment-transfer-destination"), {
      target: { value: "Lycée Horizon" },
    });
    fireEvent.change(screen.getByTestId("enrollment-transfer-reason"), {
      target: { value: "Demenagement familial" },
    });
    await user.click(screen.getByTestId("enrollment-transfer-confirm"));

    const alert = screen.queryByRole("alert");
    if (alert) {
      throw new Error(`Transfert refusé: ${alert.textContent}`);
    }

    expect(await within(tab).findAllByText("Transféré")).not.toHaveLength(0);
    expect(within(tab).getAllByText("4e A").length).toBeGreaterThan(0);

    cleanup();
    renderWorkspace("historique");
    const history = await screen.findByTestId("student-history-tab");
    expect(
      within(history).getAllByText("Transfert d'inscription").length,
    ).toBeGreaterThan(0);
    // Projection depuis destinationSchoolName dédié (pas depuis notes).
    expect(
      within(history).getAllByText("Transfert vers : Lycée Horizon").length,
    ).toBeGreaterThan(0);

    cleanup();
    renderWorkspace("inscription");
    const reopened = await screen.findByTestId("student-enrollment-tab");
    expect(within(reopened).getAllByText("Transféré").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("enrollment-transfer-start")).not.toBeInTheDocument();
    expect(screen.queryByTestId("enrollment-close-start")).not.toBeInTheDocument();

    cleanup();
    renderWorkspace("historique");
    const historyRemount = await screen.findByTestId("student-history-tab");
    expect(
      within(historyRemount).getAllByText("Transfert vers : Lycée Horizon").length,
    ).toBeGreaterThan(0);
  });
});
