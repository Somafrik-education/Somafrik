import { describe, expect, it } from "vitest";
import { buildStudentWorkspaceFromDossier } from "./studentDossierFromApi";
import type { SchoolStudent } from "./studentsApi";

function canonicalStudent(): SchoolStudent {
  return {
    id: "student-db-1",
    publicId: "CD-IN-KG-26-00003",
    studentCode: "CD-IN-KG-26-00003",
    matricule: "CD-IN-KG-26-00003",
    firstName: "gaston",
    lastName: "kalonda",
    name: "kalonda gaston",
    gender: "M",
    birthDate: "2012-01-01",
    classId: "class-2a",
    className: "2ème A",
    classCode: "CLS-2A",
    schoolId: "school-1",
    schoolCode: "CD-2026-0001",
    parentPhone: "",
    parentEmail: "",
    status: "active",
    enrollmentId: "enrollment-1",
    enrollmentDate: "2026-08-20",
    academicYearName: "2026-2027",
    enrollments: [
      {
        id: "enrollment-1",
        status: "active",
        enrollmentDate: "2026-08-20",
        classId: "class-2a",
        classCode: "CLS-2A",
        className: "2ème A",
        academicYearName: "2026-2027",
        academicYearStatus: "open",
      },
    ],
  };
}

describe("studentDossierFromApi — inscription PostgreSQL canonique", () => {
  it("préserve année, établissement et classe sans fallback Migration", () => {
    const workspace = buildStudentWorkspaceFromDossier(canonicalStudent());

    expect(workspace).not.toBeNull();
    expect(workspace?.overview.currentAcademicYear).toBe("2026-2027");
    expect(workspace?.overview.currentClassId).toBe("class-2a");
    expect(workspace?.overview.currentClassName).toBe("2ème A");
    expect(workspace?.overview.schoolCode).toBe("CD-2026-0001");
    expect(workspace?.overview.schoolName).toBe("CD-2026-0001");
    expect(workspace?.enrollments).toHaveLength(1);
    expect(workspace?.enrollments[0]).toMatchObject({
      id: "enrollment-1",
      academicYear: "2026-2027",
      classId: "class-2a",
      className: "2ème A",
      schoolCode: "CD-2026-0001",
      schoolName: "CD-2026-0001",
      source: "SCHOOL_ADMINISTRATION",
    });
    expect(workspace?.enrollments[0]?.source).not.toBe("MIGRATION");
  });
});
