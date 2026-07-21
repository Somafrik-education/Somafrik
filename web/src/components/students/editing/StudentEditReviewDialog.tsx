import { Modal } from "../../ui/Modal";
import { Button } from "../../ui/Button";
import {
  formatChangeValue,
  type StudentChangeSet,
} from "../../../lib/studentEditingChangeSet";

interface StudentEditReviewDialogProps {
  open: boolean;
  changeSet: StudentChangeSet | null;
  reason: string;
  requiresReason: boolean;
  reasonError?: string | null;
  submitting?: boolean;
  onReasonChange: (reason: string) => void;
  onBack: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function StudentEditReviewDialog({
  open,
  changeSet,
  reason,
  requiresReason,
  reasonError = null,
  submitting = false,
  onReasonChange,
  onBack,
  onConfirm,
  onClose,
}: StudentEditReviewDialogProps) {
  const canConfirm =
    !submitting &&
    Boolean(changeSet) &&
    !changeSet?.isEmpty &&
    (!requiresReason || reason.trim().length > 0);

  return (
    <Modal
      open={open}
      title="Confirmer les modifications"
      description="Vérifiez le détail des changements avant enregistrement."
      onClose={submitting ? () => undefined : onClose}
      size="lg"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={onBack}
            disabled={submitting}
          >
            Retour
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            data-testid="student-edit-confirm"
          >
            {submitting ? "Enregistrement…" : "Confirmer"}
          </Button>
        </>
      }
    >
      {changeSet && changeSet.changes.length > 0 ? (
        <ul className="space-y-4" data-testid="student-edit-changeset">
          {changeSet.changes.map((change) => (
            <li key={change.field} className="rounded-xl border border-line p-3">
              <p className="text-sm font-semibold text-ink">
                {change.label}
                {change.sensitivity === "SENSITIVE" ? (
                  <span className="ml-2 text-xs font-semibold uppercase text-amber-700">
                    Sensible
                  </span>
                ) : null}
              </p>
              <p className="mt-2 text-sm text-muted">
                <span className="line-through">
                  {formatChangeValue(change.previousValue)}
                </span>
                <span className="mx-2 text-ink">→</span>
                <span className="font-medium text-ink">
                  {formatChangeValue(change.nextValue)}
                </span>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Aucun changement.</p>
      )}

      <div className="mt-5">
        <label
          htmlFor="edit-reason"
          className="block text-xs font-semibold uppercase tracking-wide text-muted"
        >
          Raison{requiresReason ? " *" : ""}
        </label>
        <textarea
          id="edit-reason"
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
          rows={3}
          value={reason}
          disabled={submitting}
          aria-invalid={Boolean(reasonError)}
          onChange={(event) => onReasonChange(event.target.value)}
          placeholder="Ex. Mise à jour demandée par la famille"
        />
        {reasonError ? (
          <p className="mt-1 text-xs text-danger" role="alert">
            {reasonError}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
