import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../api/client";
import type { StudentEnrollment } from "../lib/studentDomain";
import type { StudentEnrollmentRecord } from "../lib/studentEnrollment";
import { buildStudentWorkspaceFromDossier } from "../lib/studentDossierFromApi";
import { buildStudentWorkspace } from "../lib/studentWorkspaceService";
import {
  buildStudentWorkspaceViewModel,
  type StudentWorkspaceViewModel,
} from "../lib/studentWorkspaceViewModel";
import { studentsApi, type SchoolStudent } from "../lib/studentsApi";

export interface UseStudentWorkspaceResult {
  workspace: StudentWorkspaceViewModel | null;
  dossier: SchoolStudent | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export interface UseStudentWorkspaceOptions {
  /** Overlay inscriptions (édition locale) — conserve la compatibilité C1.8a/C1.8b. */
  enrollmentOverride?: readonly StudentEnrollmentRecord[] | null;
}

function mapError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return "Élève introuvable.";
    if (err.status === 403) return "Accès refusé à cette fiche élève.";
    return err.message || "Impossible de charger la fiche élève.";
  }
  return "Impossible de charger la fiche élève.";
}

function toDomainEnrollment(record: StudentEnrollmentRecord): StudentEnrollment {
  return {
    id: record.id,
    studentId: record.studentId,
    schoolCode: record.schoolCode,
    academicYear: record.academicYear,
    classId: record.classId,
    className: record.className,
    programId: record.programId,
    programName: record.programName,
    status: record.status,
    source: record.source,
    applicationReference: record.applicationReference,
    requestedAt: record.requestedAt,
    enrolledAt: record.enrolledAt,
    validatedAt: record.validatedAt,
    endedAt: record.endedAt,
    transferDate: record.transferDate,
    destinationSchoolName: record.destinationSchoolName,
    closureDate: record.closureDate,
    previousSchool: record.previousSchoolName ?? undefined,
    notes: record.notes,
    enrollmentDate: record.enrolledAt ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Fiche élève — chargement canonique PostgreSQL par studentCode.
 * L'overlay d'inscription reconstruit aussi l'historique (C1.8a/C1.8b).
 */
export function useStudentWorkspace(
  studentId: string,
  options: UseStudentWorkspaceOptions = {},
): UseStudentWorkspaceResult {
  const [dossier, setDossier] = useState<SchoolStudent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const normalizedStudentId = studentId.trim();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!normalizedStudentId) {
        setDossier(null);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const row = await studentsApi.get(normalizedStudentId);
        if (!cancelled) {
          setDossier(row);
        }
      } catch (err) {
        if (!cancelled) {
          setDossier(null);
          setError(mapError(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [normalizedStudentId, revision]);

  const workspace = useMemo(() => {
    if (!dossier) return null;

    const baseWorkspace = buildStudentWorkspaceFromDossier(dossier);
    if (!baseWorkspace) return null;

    if (options.enrollmentOverride && options.enrollmentOverride.length > 0) {
      const academicYear =
        options.enrollmentOverride.find((row) => row.status === "ENROLLED" || row.status === "APPROVED")
          ?.academicYear ||
        options.enrollmentOverride[0]?.academicYear ||
        dossier.academicYearName ||
        "";

      const rebuilt = buildStudentWorkspace({
        studentId: dossier.studentCode,
        academicYear,
        data: {
          students: [
            {
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
              schoolYear: academicYear || dossier.academicYearName,
              enrollmentDate: dossier.enrollmentDate,
              schoolStatus: dossier.status === "active" ? "Inscrit" : dossier.status,
              status: dossier.status === "active" ? "Actif" : "Inactif",
              createdAt: dossier.createdAt,
              updatedAt: dossier.updatedAt,
            },
          ],
          enrollments: options.enrollmentOverride.map(toDomainEnrollment),
          guardians: [],
          guardianRelations: [],
          documents: [],
          medicalProfiles: [],
          schools: [{ code: dossier.schoolCode, name: dossier.schoolCode }],
        },
      });

      return rebuilt ? buildStudentWorkspaceViewModel(rebuilt) : null;
    }

    return buildStudentWorkspaceViewModel(baseWorkspace);
  }, [dossier, options.enrollmentOverride]);

  return {
    workspace,
    dossier,
    loading,
    error,
    refresh: async () => {
      setRevision((value) => value + 1);
    },
  };
}
