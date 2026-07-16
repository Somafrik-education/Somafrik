import { describe, expect, it } from "vitest";
import {
  adaptLegacyStudent,
  adaptLegacyStudents,
  getActiveEnrollment,
  type StudentEnrollment,
} from "./studentDomain";

describe("studentDomain", () => {
  it("adapte une fiche legacy sans supprimer ses champs", () => {
    const student = adaptLegacyStudent({
      id: "STUDENTS-123",
      publicId: "ELE-0001-0001-000001",
      schoolCode: "CD-2026-0001",
      name: "Kabeya",
      firstName: "Jean",
      className: "6e A",
      parentPhone: "+243000000000",
    });

    expect(student.id).toBe("STUDENTS-123");
    expect(student.matricule).toBe("ELE-0001-0001-000001");
    expect(student.publicId).toBe("ELE-0001-0001-000001");
    expect(student.lastName).toBe("Kabeya");
    expect(student.firstName).toBe("Jean");
    expect(student.className).toBe("6e A");
    expect(student.parentPhone).toBe("+243000000000");
  });

  it("utilise le matricule avant publicId et id", () => {
    const student = adaptLegacyStudent({
      id: "STUDENTS-123",
      matricule: "ELE-0001-0001-000002",
      publicId: "ELE-0001-0001-000001",
      schoolCode: "CD-2026-0001",
    });

    expect(student.matricule).toBe("ELE-0001-0001-000002");
    expect(student.publicId).toBe("ELE-0001-0001-000001");
  });

  it("adapte une collection sans muter les lignes source", () => {
    const source = [
      {
        id: "STUDENTS-1",
        schoolCode: "CD-2026-0001",
        name: "Ilunga",
      },
    ];

    const students = adaptLegacyStudents(source);

    expect(students).toHaveLength(1);
    expect(students[0]).not.toBe(source[0]);
    expect(source[0]).not.toHaveProperty("matricule");
  });

  it("retourne uniquement l'inscription active de l'annÃ©e ciblÃ©e", () => {
    const enrollments: StudentEnrollment[] = [
      {
        id: "ENR-1",
        studentId: "STU-1",
        schoolCode: "CD-2026-0001",
        academicYear: "2025-2026",
        status: "Sorti",
      },
      {
        id: "ENR-2",
        studentId: "STU-1",
        schoolCode: "CD-2026-0001",
        academicYear: "2026-2027",
        status: "Inscrit",
      },
    ];

    expect(
      getActiveEnrollment(
        enrollments,
        "STU-1",
        "CD-2026-0001",
        "2026-2027",
      )?.id,
    ).toBe("ENR-2");
  });
});

