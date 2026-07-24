import { useMemo, useState } from "react";
import { Button } from "../../design-system";
import type { EditableEnrollment } from "../../lib/studentEditing";
import type { StudentEditAuthorizationContext } from "../../lib/studentEditing";
import type { StudentWorkspaceCommandRepository } from "../../lib/studentEditingRepository";
import type { SchoolClassCatalogEntry } from "../../lib/studentEditing";
import { executeStudentUpdateCommand } from "../../lib/studentEditingService";
import {
  canAssignClassEnrollmentStatus,
  canCloseEnrollmentStatus,
  canTransferEnrollmentStatus,
  canValidateEnrollmentStatus,
} from "../../lib/studentEnrollmentTransitions";

interface StudentEnrollmentActionsProps {
  enrollment: EditableEnrollment | null;
  schoolClasses: readonly SchoolClassCatalogEntry[];
  canValidate: boolean;
  canAssignClass: boolean;
  canTransfer: boolean;
  canClose: boolean;
  authContext: StudentEditAuthorizationContext;
  repository: StudentWorkspaceCommandRepository;
  onSuccess: () => void;
}

type BusyAction = "validate" | "assign" | "transfer" | "close" | null;

export function StudentEnrollmentActions({
  enrollment,
  schoolClasses,
  canValidate,
  canAssignClass,
  canTransfer,
  canClose,
  authContext,
  repository,
  onSuccess,
}: StudentEnrollmentActionsProps) {
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [confirmValidate, setConfirmValidate] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [targetSchoolName, setTargetSchoolName] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [closeReason, setCloseReason] = useState("");

  const canShowValidate =
    canValidate &&
    enrollment != null &&
    canValidateEnrollmentStatus(enrollment.status);

  const canShowAssign =
    canAssignClass &&
    enrollment != null &&
    canAssignClassEnrollmentStatus(enrollment.status);

  const canShowTransfer =
    canTransfer &&
    enrollment != null &&
    canTransferEnrollmentStatus(enrollment.status) &&
    !enrollment.endedAt;

  const canShowClose =
    canClose &&
    enrollment != null &&
    canCloseEnrollmentStatus(enrollment.status) &&
    !enrollment.endedAt;

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

  if (!canShowValidate && !canShowAssign && !canShowTransfer && !canShowClose) {
    return (
      <div className="mt-8 border-t border-line pt-6" data-testid="enrollment-actions-locked">
        {error ? (
          <p className="mb-3 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="mb-3 text-sm font-medium text-ink" role="status">
            {success}
          </p>
        ) : null}
        <p className="text-xs text-muted">
          {canValidate || canAssignClass || canTransfer || canClose
            ? "Aucune action disponible pour le statut actuel."
            : "Actions administratives réservées (permissions validate / assign-class / transfer / close)."}
        </p>
      </div>
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

  const runTransfer = async () => {
    setBusy("transfer");
    setError(null);
    setSuccess(null);
    try {
      const result = await executeStudentUpdateCommand(
        {
          type: "TRANSFER_ENROLLMENT",
          studentId: enrollment.studentId,
          enrollmentId: enrollment.enrollmentId,
          expectedVersion: enrollment.version,
          changes: { targetSchoolName },
          reason: transferReason,
        },
        authContext,
        repository,
      );
      if (!result.success) {
        setError(result.errors[0]?.message ?? "Transfert refusé.");
        return;
      }
      setConfirmTransfer(false);
      setTargetSchoolName("");
      setTransferReason("");
      setSuccess("Inscription transférée. Aucune suppression physique.");
      onSuccess();
    } finally {
      setBusy(null);
    }
  };

  const runClose = async () => {
    setBusy("close");
    setError(null);
    setSuccess(null);
    try {
      const result = await executeStudentUpdateCommand(
        {
          type: "CLOSE_ENROLLMENT",
          studentId: enrollment.studentId,
          enrollmentId: enrollment.enrollmentId,
          expectedVersion: enrollment.version,
          reason: closeReason,
        },
        authContext,
        repository,
      );
      if (!result.success) {
        setError(result.errors[0]?.message ?? "Clôture refusée.");
        return;
      }
      setConfirmClose(false);
      setCloseReason("");
      setSuccess("Inscription clôturée (désinscrit). Aucune suppression physique.");
      onSuccess();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-8 border-t border-line pt-6" data-testid="enrollment-actions">
      <h3 className="text-sm font-bold text-ink">Actions administratives</h3>
      <p className="mt-1 text-xs text-muted">
        Transitions explicites : validation, affectation, transfert ou clôture.
        Aucun retour arrière implicite ni suppression physique.
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

        {canShowTransfer ? (
          <div className="flex flex-col gap-2" data-testid="enrollment-transfer-panel">
            {!confirmTransfer ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy != null}
                onClick={() => setConfirmTransfer(true)}
                data-testid="enrollment-transfer-start"
              >
                Transférer l&apos;inscription
              </Button>
            ) : (
              <>
                <p className="text-sm text-ink">
                  Transfert vers un autre établissement (pas de création
                  automatique à destination).
                </p>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-semibold text-ink">
                    Établissement de destination
                  </span>
                  <input
                    className="min-h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink"
                    value={targetSchoolName}
                    onChange={(event) => setTargetSchoolName(event.target.value)}
                    data-testid="enrollment-transfer-target"
                    placeholder="Ex. Lycée Horizon"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-semibold text-ink">Raison</span>
                  <input
                    className="min-h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink"
                    value={transferReason}
                    onChange={(event) => setTransferReason(event.target.value)}
                    data-testid="enrollment-transfer-reason"
                    placeholder="Motif du transfert"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={busy != null}
                    onClick={() => void runTransfer()}
                    data-testid="enrollment-transfer-confirm"
                  >
                    {busy === "transfer" ? "Transfert…" : "Confirmer le transfert"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy != null}
                    onClick={() => {
                      setConfirmTransfer(false);
                      setTargetSchoolName("");
                      setTransferReason("");
                    }}
                  >
                    Annuler
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {canShowClose ? (
          <div className="flex flex-col gap-2" data-testid="enrollment-close-panel">
            {!confirmClose ? (
              <Button
                type="button"
                variant="danger"
                disabled={busy != null}
                onClick={() => setConfirmClose(true)}
                data-testid="enrollment-close-start"
              >
                Clôturer l&apos;inscription
              </Button>
            ) : (
              <>
                <p className="text-sm text-ink">
                  Confirmer la clôture (statut Désinscrit)&nbsp;? L&apos;inscription
                  reste conservée.
                </p>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-semibold text-ink">Raison</span>
                  <input
                    className="min-h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink"
                    value={closeReason}
                    onChange={(event) => setCloseReason(event.target.value)}
                    data-testid="enrollment-close-reason"
                    placeholder="Motif de clôture"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="danger"
                    disabled={busy != null}
                    onClick={() => void runClose()}
                    data-testid="enrollment-close-confirm"
                  >
                    {busy === "close" ? "Clôture…" : "Confirmer la clôture"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy != null}
                    onClick={() => {
                      setConfirmClose(false);
                      setCloseReason("");
                    }}
                  >
                    Annuler
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
