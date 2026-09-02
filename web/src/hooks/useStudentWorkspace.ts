import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../api/client";
import type { StudentEnrollmentRecord } from "../lib/studentEnrollment";
import { buildStudentWorkspaceFromDossier } from "../lib/studentDossierFromApi";
import { applyEnrollmentOverrideToWorkspace } from "../lib/studentEnrollmentOverlay";
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

/**
 * Fiche élève — chargement canonique PostgreSQL par studentCode.
 * L'overlay d'inscription ne touche que enrollments + history dérivé.
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

    const withOverlay =
      options.enrollmentOverride && options.enrollmentOverride.length > 0
        ? applyEnrollmentOverrideToWorkspace(
            baseWorkspace,
            options.enrollmentOverride,
          )
        : baseWorkspace;

    return buildStudentWorkspaceViewModel(withOverlay);
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
