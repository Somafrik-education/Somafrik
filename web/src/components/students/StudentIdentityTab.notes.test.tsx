import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import type { SchoolStudent } from "../../lib/studentsApi";
import { StudentIdentityTab } from "./StudentIdentityTab";

vi.mock("../../hooks/useStudentEditingContext", () => ({
  useStudentEditingContext: () => ({
    canUpdateIdentity: false,
    canUpdateAdministrative: false,
    identity: null,
    administrative: {
      studentId: "stu-1",
      schoolCode: "CD-LAC-26-001",
      version: 1,
      updatedAt: "2026-10-10T00:00:00.000Z",
      administrativeNotes: null,
      preferredContactChannel: null,
    },
    authContext: {
      userId: "user-1",
      role: "Enseignant",
      schoolCode: "CD-LAC-26-001",
      permissions: ["Élèves:READ"],
    },
    repository: {},
    refreshFromStore: () => undefined,
  }),
}));

const workspace = {
  studentId: "stu-1",
  displayName: "Élève Fixture",
  matriculeLabel: "CD-LAC-EL-26-901",
  genderLabel: "—",
  birthDateLabel: "—",
  birthPlaceLabel: "—",
  nationalityLabel: "—",
  phoneLabel: "—",
  emailLabel: "—",
  addressLabel: "—",
} as StudentWorkspaceViewModel;

describe("StudentIdentityTab — notes administratives", () => {
  it("affiche le texte brut multiligne après rechargement, sans HTML", () => {
    const notes = "Ligne alpha — élève\n\nDeuxième ligne\nTroisième";
    const { container } = render(
      <StudentIdentityTab
        workspace={workspace}
        dossier={{
          id: "CD-LAC-EL-26-901",
          publicId: "CD-LAC-EL-26-901",
          studentCode: "CD-LAC-EL-26-901",
          matricule: "CD-LAC-EL-26-901",
          firstName: "Élève",
          lastName: "Fixture",
          name: "Élève Fixture",
          gender: "",
          birthDate: "",
          className: "",
          classCode: "",
          schoolCode: "CD-LAC-26-001",
          parentPhone: "",
          parentEmail: "",
          administrativeNotes: notes,
          status: "active",
          enrollmentId: null,
          enrollmentDate: "",
          academicYearName: "",
        } satisfies SchoolStudent}
      />,
    );
    const node = screen.getByTestId("student-administrative-notes");
    expect(node).toHaveClass("whitespace-pre-wrap");
    expect(node.textContent).toBe(notes);
    expect(node.querySelector("*")).toBeNull();
    expect(node.innerHTML).not.toMatch(/<b[\s>]/i);
    expect(container.querySelector("[data-testid='student-administrative-notes'] b")).toBeNull();
  });
});
