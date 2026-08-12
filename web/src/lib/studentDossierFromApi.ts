import type { Student, StudentEnrollment, StudentDocument } from "./studentDomain";
import type { StudentEnrollmentRecord } from "./studentEnrollment";
import type { StudentGuardianRelationRecord } from "./studentGuardian";
import type { StudentMedicalRecord } from "./studentMedical";
import type { StudentDocumentRecord } from "./studentDocuments";
import { buildStudentWorkspace, type StudentWorkspace } from "./studentWorkspaceService";
import type { SchoolStudent } from "./studentsApi";

function mapEnrollmentStatus(status: string): StudentEnrollment["status"] {
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (
    normalized === "active" ||
    normalized === "actif" ||
    normalized === "enrolled" ||
    normalized === "inscrit"
  ) {
    return "ENROLLED";
  }
  if (normalized === "approved" || normalized === "approuve") {
    return "APPROVED";
  }
  if (normalized === "closed" || normalized === "cloture" || normalized === "cloturee") {
    return "CLOSED";
  }
  if (normalized === "transferred" || normalized === "transfere") {
    return "TRANSFERRED";
  }
  if (normalized === "suspended" || normalized === "suspendu") {
    return "SUSPENDED";
  }
  if (normalized === "withdrawn" || normalized === "retire" || normalized === "abandonne") {
    return "WITHDRAWN";
  }
  if (normalized === "completed" || normalized === "termine") {
    return "COMPLETED";
  }
  if (normalized === "graduated" || normalized === "diplome") {
    return "GRADUATED";
  }
  if (normalized === "rejected" || normalized === "refuse") {
    return "REJECTED";
  }
  if (
    normalized === "pre_registered" ||
    normalized === "pre-registered" ||
    normalized === "preinscrit"
  ) {
    return "PRE_REGISTERED";
  }
  if (normalized === "pending_review" || normalized === "pending" || normalized === "en_attente") {
    return "PENDING_REVIEW";
  }
  if (normalized === "incomplete" || normalized === "incomplet") {
    return "INCOMPLETE";
  }

  // Fail-closed : un statut inconnu ne doit jamais apparaître comme inscription active.
  return "CLOSED";
}

function toDomainStudent(dossier: SchoolStudent): Student {
  return {
    id: dossier.studentCode,
    publicId: dossier.publicId || dossier.studentCode,
    matricule: dossier.matricule || dossier.studentCode,
    schoolCode: dossier.schoolCode,
    firstName: dossier.firstName,
    lastName: dossier.lastName,
    name: dossier.name || `${dossier.firstName} ${dossier.lastName}`.trim(),
    gender: dossier.gender,
    birthDate: dossier.birthDate,
    birthPlace: dossier.birthPlace,
    photoUrl: dossier.photoUrl,
    phone: dossier.parentPhone,
    email: dossier.parentEmail,
    parentPhone: dossier.parentPhone,
    className: dossier.className,
    schoolYear: dossier.academicYearName,
    enrollmentDate: dossier.enrollmentDate,
    schoolStatus: dossier.status === "active" ? "Inscrit" : dossier.status,
    status: dossier.status === "active" ? "Actif" : "Inactif",
    createdAt: dossier.createdAt,
    updatedAt: dossier.updatedAt,
  };
}

function toDomainEnrollments(dossier: SchoolStudent): StudentEnrollment[] {
  const rows = dossier.enrollments?.length
    ? dossier.enrollments
    : dossier.enrollmentId
      ? [
          {
            id: String(dossier.enrollmentId),
            status: "active",
            enrollmentDate: dossier.enrollmentDate,
            classCode: dossier.classCode,
            className: dossier.className,
            academicYearName: dossier.academicYearName,
          },
        ]
      : [];

  return rows.map((row) => ({
    id: String(row.id),
    studentId: dossier.studentCode,
    schoolCode: dossier.schoolCode,
    academicYear: row.academicYearName,
    classId: row.classCode,
    className: row.className,
    status: mapEnrollmentStatus(row.status),
    source: "postgresql",
    enrolledAt: row.enrollmentDate || undefined,
    enrollmentDate: row.enrollmentDate || undefined,
    createdAt: row.createdAt ?? undefined,
    updatedAt: row.updatedAt ?? undefined,
  }));
}

function toDomainDocuments(dossier: SchoolStudent): StudentDocument[] {
  return (dossier.documents ?? []).map((doc) => ({
    id: doc.documentCode || doc.id,
    studentId: dossier.studentCode,
    documentType: doc.documentType || "",
    fileUrl: doc.fileUrl || "",
    createdAt: doc.createdAt ?? undefined,
  }));
}

function toDomainMedicalProfiles(dossier: SchoolStudent) {
  if (!dossier.medical) return [];
  return [
    {
      id: `med-${dossier.studentCode}`,
      studentId: dossier.studentCode,
      bloodType: dossier.medical.bloodType || undefined,
      allergies: (dossier.medical.allergies ?? []).join(", ") || undefined,
      chronicConditions: (dossier.medical.conditions ?? []).join(", ") || undefined,
      medications: (dossier.medical.medications ?? []).join(", ") || undefined,
      confidentialNotes: dossier.medical.notes || undefined,
      doctorPhone: dossier.medical.emergencyContact || undefined,
    },
  ];
}

function toDomainGuardians(dossier: SchoolStudent) {
  const guardians = [];
  const guardianRelations = [];
  const persons = [];
  for (const row of dossier.guardians ?? []) {
    const id = String(row.id ?? "").trim();
    if (!id) continue;
    const personId = `person-${id}`;
    const firstName = String(row.firstName ?? "").trim();
    const lastName = String(row.lastName ?? "").trim();
    persons.push({
      id: personId,
      firstName: firstName || "Responsable",
      lastName: lastName || String(row.name ?? "").trim() || id,
      phone: String(row.phone ?? "").trim() || undefined,
      email: String(row.email ?? "").trim() || undefined,
    });
    guardians.push({
      id,
      personId,
    });
    guardianRelations.push({
      id: `rel-${dossier.studentCode}-${id}`,
      studentId: dossier.studentCode,
      guardianId: id,
      relationshipType: String(row.relationshipType ?? "OTHER"),
      isPrimaryContact: Boolean(row.isPrimaryContact),
      isLegalGuardian: Boolean(row.isLegalGuardian ?? true),
      isEmergencyContact: Boolean(row.isEmergencyContact),
      isFinanciallyResponsible: Boolean(row.isFinanciallyResponsible),
      status: "Actif" as const,
      priority: row.isPrimaryContact ? 1 : 2,
    });
  }
  return { guardians, guardianRelations, persons };
}

/**
 * Construit le workspace fiche à partir de la fiche PostgreSQL `/api/students/:studentCode`.
 */
export function buildStudentWorkspaceFromDossier(
  dossier: SchoolStudent,
): StudentWorkspace | null {
  const student = toDomainStudent(dossier);
  const enrollments = toDomainEnrollments(dossier);
  const documents = toDomainDocuments(dossier);
  const medicalProfiles = toDomainMedicalProfiles(dossier);
  const { guardians, guardianRelations, persons } = toDomainGuardians(dossier);
  const academicYear =
    dossier.academicYearName ||
    enrollments.find((row) => row.status === "ENROLLED" || row.status === "APPROVED")?.academicYear ||
    "";

  return buildStudentWorkspace({
    studentId: student.id,
    academicYear,
    data: {
      students: [student],
      persons,
      enrollments,
      guardians,
      guardianRelations,
      documents,
      medicalProfiles,
      schools: [{ code: dossier.schoolCode, name: dossier.schoolCode }],
    },
  });
}

export type {
  StudentEnrollmentRecord,
  StudentGuardianRelationRecord,
  StudentMedicalRecord,
  StudentDocumentRecord,
};
