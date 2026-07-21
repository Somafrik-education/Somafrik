import { Modal } from "../../ui/Modal";
import { Button } from "../../ui/Button";

interface StudentUnsavedChangesDialogProps {
  open: boolean;
  onStay: () => void;
  onDiscard: () => void;
}

export function StudentUnsavedChangesDialog({
  open,
  onStay,
  onDiscard,
}: StudentUnsavedChangesDialogProps) {
  return (
    <Modal
      open={open}
      title="Modifications non enregistrées"
      description="Des modifications n'ont pas été enregistrées. Voulez-vous les abandonner ?"
      onClose={onStay}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onStay}>
            Continuer l&apos;édition
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={onDiscard}
            data-testid="student-edit-discard"
          >
            Abandonner
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">
        Les changements non confirmés seront perdus.
      </p>
    </Modal>
  );
}
