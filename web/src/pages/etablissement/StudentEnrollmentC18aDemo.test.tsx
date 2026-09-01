/**
 * Démo fonctionnelle C1.8a — gate manuel CTO #74.
 * Parcours UI : PENDING_REVIEW → valider → affecter → historique → remount overlay.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const { SCHOOL, SCHOOL_ID, STUDENT_ID, ENROLLMENT_ID, dataState, studentsApiGet } = vi.hoisted(() => {
  const SCHOOL = "CD-2026-0001";
  const SCHOOL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const STUDENT_ID = "stu-c18a-demo";
  const ENROLLMENT_ID = "enr-c18a-demo";
  const dataState = {
    current: {
      schools: [{ code: SCHOOL, name: "Collège Démo C1.8a" }],
      classes: [
        { id: "CLS-4A", name: "4e A", schoolCode: SCHOOL },
        { id: "CLS-5B", name: "5e B", schoolCode: SCHOOL },
      ],
      students: [
        {
          id: STUDENT_ID,
          matricule: "M-C18A",
          firstName: "Léa",
          lastName: "Kabongo",
          name: "Kabongo",
          schoolCode: SCHOOL,
          schoolId: SCHOOL_ID,
          schoolYear: "2026-2027",
          schoolStatus: "En examen",
        },
      ],
      studentEnrollments: [
        {
          id: ENROLLMENT_ID,
          studentId: STUDENT_ID,
          schoolCode: SCHOOL,
          academicYear: "2026-2027",
          status: "PENDING_REVIEW",
          source: "SCHOOL_ADMINISTRATION",
          classId: null,
          className: null,
          requestedAt: "2026-05-01",
          validatedAt: null,
          enrolledAt: null,
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
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
          "Élèves:UPDATE",
          "student.enrollments.validate",
          "student.enrollments.assign-class",
        ],
      },
    } as Record<string, unknown>,
  };

  function buildDossier() {
    const enrollment = (dataState.current.studentEnrollments as Array<Record<string, unknown>>)[0];
    return {
      id: STUDENT_ID,
      publicId: STUDENT_ID,
      studentCode: STUDENT_ID,
      matricule: "M-C18A",
      firstName: "Léa",
      lastName: "Kabongo",
      name: "Léa Kabongo",
      gender: "",
      birthDate: "",
      birthPlace: "",
      className: String(enrollment?.className ?? "") || "",
      classCode: String(enrollment?.classId ?? "") || "",
      schoolCode: SCHOOL,
      parentPhone: "",
      parentEmail: "",
      status: "active",
      enrollmentId: ENROLLMENT_ID,
      enrollmentDate: "",
      academicYearName: "2026-2027",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      enrollments: [
        {
          id: ENROLLMENT_ID,
          status: String(enrollment?.status ?? "PENDING_REVIEW"),
          enrollmentDate: "",
          classCode: String(enrollment?.classId ?? "") || "",
          className: String(enrollment?.className ?? "") || "",
          academicYearName: "2026-2027",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        },
      ],
      guardians: [],
      medical: {
        allergies: [],
        conditions: [],
        medications: [],
        notes: "",
        emergencyContact: "",
        bloodType: "",
      },
      documents: [],
      access: {
        notesPath: `/api/students/${STUDENT_ID}/notes`,
        presencesPath: `/api/students/${STUDENT_ID}/presences`,
        paymentsPath: `/api/students/${STUDENT_ID}/payments`,
        reportPath: `/api/students/${STUDENT_ID}/report`,
      },
    };
  }

  const studentsApiGet = vi.fn(async () => buildDossier());
  return { SCHOOL, SCHOOL_ID, STUDENT_ID, ENROLLMENT_ID, dataState, studentsApiGet };
});

vi.mock("../../lib/studentsApi", () => ({
  studentsApi: {
    list: vi.fn(async () => []),
    get: studentsApiGet,
    update: vi.fn(),
  },
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "u-secretaire",
        role: "Secrétaire",
        schoolCode: SCHOOL,
        schoolId: SCHOOL_ID,
        identifier: "secretaire@demo.local",
        permissions: [
          "Élèves:READ",
          "Élèves:UPDATE",
          "student.enrollments.validate",
          "student.enrollments.assign-class",
        ],
      },
      permissions: [
        "Élèves:READ",
        "Élèves:UPDATE",
        "student.enrollments.validate",
        "student.enrollments.assign-class",
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
      schoolId: SCHOOL_ID,
      name: "Secrétaire Démo",
    },
  }),
}));

import { resetStudentEditingSessionsForTests } from "../../hooks/useStudentEditingContext";
import { StudentWorkspacePage } from "./StudentWorkspacePage";

function renderWorkspace(section = "inscription") {
  return render(
    <MemoryRouter
      initialEntries={[
        `/etablissement/eleves/${STUDENT_ID}/${section}`,
      ]}
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

describe("C1.8a démo manuelle — validate → assign → historique → remount", () => {
  beforeEach(() => {
    cleanup();
    resetStudentEditingSessionsForTests();
    studentsApiGet.mockClear();
    // Remet l'inscription initiale pour chaque run (le store mock est partagé par élève).
    dataState.current.studentEnrollments = [
      {
        id: ENROLLMENT_ID,
        studentId: STUDENT_ID,
        schoolCode: SCHOOL,
        academicYear: "2026-2027",
        status: "PENDING_REVIEW",
        source: "SCHOOL_ADMINISTRATION",
        classId: null,
        className: null,
        requestedAt: "2026-05-01",
        validatedAt: null,
        enrolledAt: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ];
  });

  it("parcourt le gate CTO complet sur le dossier élève", async () => {
    const user = userEvent.setup();
    renderWorkspace("inscription");

    const enrollmentTab = await screen.findByTestId("student-enrollment-tab");
    expect(
      within(enrollmentTab).getAllByText("En examen").length,
    ).toBeGreaterThan(0);
    expect(screen.getByTestId("enrollment-actions")).toBeInTheDocument();
    expect(studentsApiGet).toHaveBeenCalledWith(STUDENT_ID);

    // 1) Valider
    await user.click(screen.getByTestId("enrollment-validate-start"));
    await user.click(screen.getByTestId("enrollment-validate-confirm"));

    expect(
      await screen.findByText(/Inscription validée\. L'historique/i),
    ).toBeInTheDocument();
    expect(
      within(enrollmentTab).getAllByText("Validé").length,
    ).toBeGreaterThan(0);
    // validatedAt renseigné (plus « Date non renseignée » sur la ligne validation)
    const validationField = within(enrollmentTab)
      .getByText("Date de validation")
      .closest("div");
    expect(validationField).toBeTruthy();
    expect(validationField?.textContent).not.toMatch(/Date non renseignée/);

    // 2) Affecter une classe catalogue
    await user.selectOptions(screen.getByTestId("enrollment-class-select"), "CLS-4A");
    await user.click(screen.getByTestId("enrollment-assign-confirm"));

    expect(
      await screen.findByText(/Élève affecté à 4e A/i),
    ).toBeInTheDocument();
    expect(
      within(enrollmentTab).getAllByText("Inscrit").length,
    ).toBeGreaterThan(0);
    expect(
      within(enrollmentTab).getAllByText("4e A").length,
    ).toBeGreaterThan(0);

    // 3) Historique — deux entrées métier
    cleanup();
    renderWorkspace("historique");
    const historyTab = await screen.findByTestId("student-history-tab");
    expect(
      within(historyTab).getAllByText("Inscription validée").length,
    ).toBeGreaterThan(0);
    expect(
      within(historyTab).getAllByText("Affectation de classe").length,
    ).toBeGreaterThan(0);

    // 4) Remount / réouverture — cohérence overlay store mock
    cleanup();
    renderWorkspace("inscription");
    const reopened = await screen.findByTestId("student-enrollment-tab");
    expect(within(reopened).getAllByText("Inscrit").length).toBeGreaterThan(0);
    expect(within(reopened).getAllByText("4e A").length).toBeGreaterThan(0);
    // Plus d'action validate (statut final)
    expect(
      screen.queryByTestId("enrollment-validate-start"),
    ).not.toBeInTheDocument();
  });
});
