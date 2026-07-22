import { Button, Modal } from "../../../design-system";
import type { StudentEditConflict } from "../../../lib/studentEditing";

interface StudentEditConflictDialogProps {
  open: boolean;
  conflict: StudentEditConflict | null;
  onReload: () => void;
  onClose: () => void;
}

export function StudentEditConflictDialog({
  open,
  conflict,
  onReload,
  onClose,
}: StudentEditConflictDialogProps) {
  return (
    <Modal
      open={open}
      title="Conflit de version"
      description="Le dossier a été modifié par un autre utilisateur. Rechargez les données avant de réessayer."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Fermer
          </Button>
          <Button type="button" onClick={onReload} data-testid="student-edit-reload">
            Recharger
          </Button>
        </>
      }
    >
      {conflict ? (
        <dl className="grid gap-3 text-sm" data-testid="student-edit-conflict">
          <div>
            <dt className="text-xs font-semibold uppercase text-muted">
              Version attendue
            </dt>
            <dd className="mt-1 font-medium text-ink">{conflict.expectedVersion}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted">
              Version actuelle
            </dt>
            <dd className="mt-1 font-medium text-ink">{conflict.currentVersion}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted">
              Dernière mise à jour
            </dt>
            <dd className="mt-1 font-medium text-ink">{conflict.currentUpdatedAt}</dd>
          </div>
        </dl>
      ) : null}
      <p className="mt-4 text-sm text-muted" role="status" aria-live="polite">
        Aucun écrasement silencieux n&apos;a été effectué.
      </p>
    </Modal>
  );
}
