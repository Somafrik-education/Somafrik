import { describe, expect, it } from "vitest";
import { buildStudentWorkspaceFromDossier } from "./studentDossierFromApi";
import { applyEnrollmentOverrideToWorkspace } from "./studentEnrollmentOverlay";
import type { StudentEnrollmentRecord } from "./studentEnrollment";
import type { SchoolStudent } from "./studentsApi";

function buildDossier(): SchoolStudent {
  return {
    id: "ELE-DOC-1",
    publicId: "ELE-DOC-1",
    studentCode: "ELE-DOC-1",
    matricule: "ELE-DOC-1",
    firstName: "Awa",
    lastName: "Diop",
    name: "Awa Diop",
    gender: "Féminin",
    birthDate: "12-04-2012",
    className: "6ème A",
    classCode: "CLS-6A",
    schoolCode: "CD-2026-0001",
    parentPhone: "+221770000000",
    parentEmail: "",
    status: "active",
    enrollmentId: "enr-1",
    enrollmentDate: "01-09-2025",
    academicYearName: "2025-2026",
    createdAt: "2025-09-01T00:00:00.000Z",
    updatedAt: "2025-09-01T00:00:00.000Z",
    enrollments: [
      {
        id: "enr-1",
        status: "active",
        enrollmentDate: "01-09-2025",
        classCode: "CLS-6A",
        className: "6ème A",
        academicYearName: "2025-2026",
      },
    ],
    guardians: [
      {
        id: "g-1",
        firstName: "Moussa",
        lastName: "Diop",
        phone: "+221771111111",
        relationshipType: "FATHER",
        isPrimaryContact: true,
        isLegalGuardian: true,
      },
    ],
    medical: {
      allergies: ["Arachides"],
      conditions: ["Asthme"],
      medications: ["Ventoline"],
      notes: "Surveillance sportive",
      emergencyContact: "+221772222222",
      bloodType: "O+",
    },
    documents: [
      {
        id: "DOC-1",
        documentCode: "DOC-1",
        documentType: "BIRTH_CERTIFICATE",
        title: "Acte de naissance",
        format: "PDF",
        version: "1",
        status: "available",
        fileUrl: "s3://bucket/acte.pdf",
      },
    ],
  };
}

function enrollmentOverride(
  status: StudentEnrollmentRecord["status"],
): StudentEnrollmentRecord[] {
  return [
    {
      id: "enr-1",
      studentId: "ELE-DOC-1",
      schoolCode: "CD-2026-0001",
      academicYear: "2025-2026",
      classId: "CLS-6A",
      className: "6ème A",
      programId: null,
      programName: null,
      status,
      source: "SCHOOL_ADMINISTRATION",
      applicationReference: null,
      requestedAt: "2025-08-01",
      enrolledAt: "2025-09-01",
      validatedAt: "2025-08-20",
      endedAt: status === "CLOSED" ? "2026-06-30" : null,
      transferDate: null,
      destinationSchoolName: null,
      closureDate: status === "CLOSED" ? "2026-06-30" : null,
      previousSchoolName: null,
      notes: null,
      schoolName: "CD-2026-0001",
      createdAt: "2025-08-01T00:00:00.000Z",
      updatedAt: "2025-09-01T00:00:00.000Z",
    },
  ];
}

describe("applyEnrollmentOverrideToWorkspace", () => {
  it("conserve documents, médical et responsables sous overlay d'inscription", () => {
    const base = buildStudentWorkspaceFromDossier(buildDossier());
    expect(base).not.toBeNull();
    if (!base) return;

    expect(base.documents.documents.length).toBeGreaterThan(0);
    expect(base.guardians.length).toBeGreaterThan(0);
    expect(base.medical.hasProfile).toBe(true);
    expect(base.medical.source).not.toBe("EMPTY");
    expect(base.overview.hasDocuments).toBe(true);
    expect(base.overview.hasGuardians).toBe(true);
    expect(base.overview.hasMedicalProfile).toBe(true);

    const overlaid = applyEnrollmentOverrideToWorkspace(
      base,
      enrollmentOverride("CLOSED"),
    );

    expect(overlaid.enrollments[0]?.status).toBe("CLOSED");
    expect(overlaid.documents).toEqual(base.documents);
    expect(overlaid.guardians).toEqual(base.guardians);
    expect(overlaid.medical).toEqual(base.medical);
    expect(overlaid.overview.hasDocuments).toBe(true);
    expect(overlaid.overview.hasGuardians).toBe(true);
    expect(overlaid.overview.hasMedicalProfile).toBe(true);
    expect(overlaid.overview.guardiansCount).toBe(base.overview.guardiansCount);
    expect(overlaid.documents.documents.some((doc) => doc.type === "BIRTH_CERTIFICATE")).toBe(
      true,
    );
    expect(overlaid.guardians[0]?.displayName).toMatch(/Diop|Moussa/);
    expect(overlaid.medical.allergies.length).toBeGreaterThan(0);
    expect(
      overlaid.history.events.some(
        (event) =>
          event.type.includes("ENROLLMENT") ||
          event.title.toLowerCase().includes("clôture") ||
          event.title.toLowerCase().includes("cloture"),
      ),
    ).toBe(true);
  });
});
