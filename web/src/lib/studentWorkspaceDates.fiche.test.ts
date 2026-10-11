import { describe, expect, it } from "vitest";
import { toApiDate } from "./dates";
import { normalizeCivilDate } from "./studentEditingChangeSet";
import { toEditableStudentIdentityFromDossier } from "./studentEditingAdapters";
import { buildIdentityPatchPayload } from "./studentIdentityHttp";
import type { StudentEnrollmentRecord } from "./studentEnrollment";
import { buildStudentEnrollmentViewModel } from "./studentEnrollmentViewModel";
import { buildStudentWorkspace } from "./studentWorkspaceService";
import { buildStudentWorkspaceViewModel } from "./studentWorkspaceViewModel";
import type { Student } from "./studentDomain";
import type { SchoolStudent } from "./studentsApi";
import type { EditableStudentIdentity } from "./studentEditing";

const UPDATED_AT = "2026-09-30T12:00:00.000Z";

function student(overrides: Partial<Student> = {}): Student {
  return {
    id: "CD-ITR-AS-26-00004",
    matricule: "CD-ITR-AS-26-00004",
    schoolCode: "CD-ITR-26-001",
    firstName: "Awa",
    lastName: "Diallo",
    birthDate: "12-04-2012",
    enrollmentDate: "01-09-2026",
    ...overrides,
  };
}

function dossier(overrides: Partial<SchoolStudent> = {}): SchoolStudent {
  return {
    id: "CD-ITR-AS-26-00004",
    publicId: "CD-ITR-AS-26-00004",
    studentCode: "CD-ITR-AS-26-00004",
    matricule: "CD-ITR-AS-26-00004",
    firstName: "Awa",
    lastName: "Diallo",
    name: "Awa Diallo",
    gender: "Féminin",
    birthDate: "12-04-2012",
    birthPlace: "Kinshasa",
    className: "6ème A",
    classCode: "CLS-6A",
    schoolCode: "CD-ITR-26-001",
    parentPhone: "+243800000001",
    parentEmail: "parent@test.local",
    status: "active",
    enrollmentId: "enr-1",
    enrollmentDate: "01-09-2026",
    academicYearName: "2026-2027",
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function enrollment(
  overrides: Partial<StudentEnrollmentRecord> = {},
): StudentEnrollmentRecord {
  return {
    id: "enr-1",
    studentId: "CD-ITR-AS-26-00004",
    schoolCode: "CD-ITR-26-001",
    academicYear: "2026-2027",
    classId: "CLS-6A",
    className: "6ème A",
    programId: null,
    programName: null,
    status: "ENROLLED",
    source: "SCHOOL_ADMINISTRATION",
    applicationReference: null,
    requestedAt: "01-09-2026",
    validatedAt: "10-09-2026",
    enrolledAt: "15-09-2026",
    endedAt: null,
    transferDate: null,
    destinationSchoolName: null,
    closureDate: null,
    previousSchoolName: null,
    notes: null,
    schoolName: "Lycée Test",
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-15T08:00:00.000Z",
    ...overrides,
  };
}

describe("FICHE-FIX-02 — consommateurs fiche élève", () => {
  it("DATE-10 : affichage identique après rechargement de fiche", () => {
    const first = buildStudentWorkspace({
      studentId: "CD-ITR-AS-26-00004",
      academicYear: "2026-2027",
      data: { students: [student()] },
    });
    expect(first).not.toBeNull();
    const firstVm = buildStudentWorkspaceViewModel(first!);
    expect(firstVm.birthDateLabel).toBe("12 avril 2012");
    expect(firstVm.enrollmentDateLabel).toBe("01 septembre 2026");

    const reloaded = buildStudentWorkspace({
      studentId: "CD-ITR-AS-26-00004",
      academicYear: "2026-2027",
      data: { students: [student({ birthDate: "12-04-2012" })] },
    });
    const reloadedVm = buildStudentWorkspaceViewModel(reloaded!);
    expect(reloadedVm.birthDateLabel).toBe(firstVm.birthDateLabel);
    expect(reloadedVm.enrollmentDateLabel).toBe(firstVm.enrollmentDateLabel);

    const isoReload = buildStudentWorkspace({
      studentId: "CD-ITR-AS-26-00004",
      academicYear: "2026-2027",
      data: { students: [student({ birthDate: "2012-04-12" })] },
    });
    expect(buildStudentWorkspaceViewModel(isoReload!).birthDateLabel).toBe(
      "12 avril 2012",
    );
  });

  it("DATE-11 : ouverture et enregistrement d'identité sans décalage", () => {
    const editable = toEditableStudentIdentityFromDossier(dossier());
    expect(editable.birthDate).toBe("2012-04-12");
    expect(normalizeCivilDate("12-04-2012")).toBe("2012-04-12");
    expect(normalizeCivilDate("2012-04-12")).toBe("2012-04-12");
    expect(toApiDate(editable.birthDate)).toBe("2012-04-12");
    expect(toApiDate("12-04-2012")).toBe(toApiDate("2012-04-12"));

    const sameDate = buildIdentityPatchPayload(
      {
        type: "UPDATE_STUDENT_IDENTITY",
        studentId: editable.studentId,
        expectedVersion: editable.version,
        changes: { birthDate: "12-04-2012" },
      },
      editable,
    );
    expect(sameDate.ok).toBe(false);

    const built = buildIdentityPatchPayload(
      {
        type: "UPDATE_STUDENT_IDENTITY",
        studentId: editable.studentId,
        expectedVersion: editable.version,
        changes: { birthDate: "13-04-2012" },
      },
      editable,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload.birthDate).toBe("2012-04-13");

    const afterGet = toEditableStudentIdentityFromDossier(
      dossier({ birthDate: "12-04-2012" }),
    );
    expect(afterGet.birthDate).toBe(editable.birthDate);

    const current: EditableStudentIdentity = {
      ...editable,
      birthDate: "2012-04-12",
    };
    const unchanged = buildIdentityPatchPayload(
      {
        type: "UPDATE_STUDENT_IDENTITY",
        studentId: current.studentId,
        expectedVersion: current.version,
        changes: { firstName: "Awa" },
      },
      current,
    );
    expect(unchanged.ok).toBe(true);
    if (!unchanged.ok) return;
    expect(unchanged.payload).not.toHaveProperty("birthDate");
  });

  it("DATE-12 : dates administratives d'inscription sans régression", () => {
    const dmy = buildStudentEnrollmentViewModel(
      enrollment({
        requestedAt: "01-09-2026",
        validatedAt: "10-09-2026",
        enrolledAt: "15-09-2026",
      }),
    );
    expect(dmy.requestedAtLabel).toBe("01 septembre 2026");
    expect(dmy.validatedAtLabel).toBe("10 septembre 2026");
    expect(dmy.enrolledAtLabel).toBe("15 septembre 2026");
    expect(dmy.endedAtLabel).toBe("Date non renseignée");

    const iso = buildStudentEnrollmentViewModel(
      enrollment({
        requestedAt: "2026-09-01",
        validatedAt: "2026-09-10",
        enrolledAt: "2026-09-15T08:00:00.000Z",
        endedAt: "2027-06-30",
      }),
    );
    expect(iso.requestedAtLabel).toBe("01 septembre 2026");
    expect(iso.validatedAtLabel).toBe("10 septembre 2026");
    expect(iso.enrolledAtLabel).toBe("15 septembre 2026");
    expect(iso.endedAtLabel).toBe("30 juin 2027");

    const workspace = buildStudentWorkspace({
      studentId: "CD-ITR-AS-26-00004",
      academicYear: "2026-2027",
      data: {
        students: [student({ enrollmentDate: "15-09-2026" })],
      },
    });
    expect(buildStudentWorkspaceViewModel(workspace!).enrollmentDateLabel).toBe(
      "15 septembre 2026",
    );
  });
});
