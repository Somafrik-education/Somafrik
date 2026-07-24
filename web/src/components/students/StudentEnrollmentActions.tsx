import { useMemo, useState } from "react";
import { Button } from "../../design-system";
import type { EditableEnrollment } from "../../lib/studentEditing";
import type { StudentEditAuthorizationContext } from "../../lib/studentEditing";
import type { StudentWorkspaceCommandRepository } from "../../lib/studentEditingRepository";
import type { SchoolClassCatalogEntry } from "../../lib/studentEditing";
import { executeStudentUpdateCommand } from "../../lib/studentEditingService";
import {
  canAssignClassEnrollmentStatus,
  canValidateEnrollmentStatus,
} from "../../lib/studentEnrollmentTransitions";

interface StudentEnrollmentActionsProps {
  enrollment: EditableEnrollment | null;
  schoolClasses: readonly SchoolClassCatalogEntry[];
  canValidate: boolean;
  canAssignClass: boolean;
  authContext: StudentEditAuthorizationContext;
  repository: StudentWorkspaceCommandRepository;
  onSuccess: () => void;
}

export function StudentEnrollmentActions({
  enrollment,
  schoolClasses,
  canValidate,
  canAssignClass,
  authContext,
  repository,
  onSuccess,
}: StudentEnrollmentActionsProps) {
  const [busy, setBusy] = useState<"validate" | "assign" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [confirmValidate, setConfirmValidate] = useState(false);

  const canShowValidate =
    canValidate &&
    enrollment != null &&
    canValidateEnrollmentStatus(enrollment.status);

  const canShowAssign =
    canAssignClass &&
    enrollment != null &&
    canAssignClassEnrollmentStatus(enrollment.status);

  const classOptions = useMemo(
    () =>
      [...schoolClasses].sort((left, right) =>
        left.name.localeCompare(right.name, "fr"),
      ),
    [schoolClasses],
  );

  if (!enrollment) {
    return null;
  }

  if (!canShowValidate && !canShowAssign) {
    return (
      <p className="mt-8 text-xs text-muted" data-testid="enrollment-actions-locked">
        {canValidate || canAssignClass
          ? "Aucune action disponible pour le statut actuel."
          : "Actions administratives réservées (permissions validate / assign-class)."}
      </p>
    );
  }

  const runValidate = async () => {
    setBusy("validate");
    setError(null);
    setSuccess(null);
    try {
      const result = await executeStudentUpdateCommand(
        {
          type: "VALIDATE_ENROLLMENT",
          studentId: enrollment.studentId,
          enrollmentId: enrollment.enrollmentId,
          expectedVersion: enrollment.version,
        },
        authContext,
        repository,
      );
      if (!result.success) {
        setError(
          result.errors[0]?.message ?? "Validation de l'inscription refusée.",
        );
        return;
      }
      setConfirmValidate(false);
      setSuccess("Inscription validée. L'historique a été mis à jour.");
      onSuccess();
    } finally {
      setBusy(null);
    }
  };

  const runAssign = async () => {
    const selected = classOptions.find((item) => item.id === selectedClassId);
    if (!selected) {
      setError("Sélectionnez une classe existante avant d'affecter.");
      return;
    }
    setBusy("assign");
    setError(null);
    setSuccess(null);
    try {
      const result = await executeStudentUpdateCommand(
        {
          type: "ASSIGN_ENROLLMENT_CLASS",
          studentId: enrollment.studentId,
          enrollmentId: enrollment.enrollmentId,
          expectedVersion: enrollment.version,
          changes: {
            classId: selected.id,
            className: selected.name,
          },
        },
        authContext,
        repository,
      );
      if (!result.success) {
        setError(
          result.errors[0]?.message ?? "Affectation de classe refusée.",
        );
        return;
      }
      setSuccess(`Élève affecté à ${selected.name}. L'historique a été mis à jour.`);
      onSuccess();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-8 border-t border-line pt-6" data-testid="enrollment-actions">
      <h3 className="text-sm font-bold text-ink">Actions administratives</h3>
      <p className="mt-1 text-xs text-muted">
        Transitions explicites : validation puis affectation de classe. Aucun
        retour arrière implicite.
      </p>

      {error ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mt-3 text-sm font-medium text-ink" role="status">
          {success}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-4">
        {canShowValidate ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {!confirmValidate ? (
              <Button
                type="button"
                disabled={busy != null}
                onClick={() => setConfirmValidate(true)}
                data-testid="enrollment-validate-start"
              >
                Valider l&apos;inscription
              </Button>
            ) : (
              <>
                <p className="text-sm text-ink">
                  Confirmer le passage au statut Validé&nbsp;?
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={busy != null}
                    onClick={() => void runValidate()}
                    data-testid="enrollment-validate-confirm"
                  >
                    {busy === "validate" ? "Validation…" : "Confirmer"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy != null}
                    onClick={() => setConfirmValidate(false)}
                  >
                    Annuler
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {canShowAssign ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
              <span className="font-semibold text-ink">Classe</span>
              <select
                className="min-h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink"
                value={selectedClassId}
                onChange={(event) => setSelectedClassId(event.target.value)}
                data-testid="enrollment-class-select"
              >
                <option value="">Sélectionner une classe…</option>
                {classOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              disabled={busy != null || !selectedClassId}
              onClick={() => void runAssign()}
              data-testid="enrollment-assign-confirm"
            >
              {busy === "assign" ? "Affectation…" : "Affecter à la classe"}
            </Button>
          </div>
        ) : null}

        {canShowAssign && classOptions.length === 0 ? (
          <p className="text-xs text-muted">
            Aucune classe n&apos;est disponible pour cet établissement.
          </p>
        ) : null}
      </div>
    </div>
  );
}
