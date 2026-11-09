import { Button, Modal } from "../../design-system";
import { studentCardMediumLabel } from "../../lib/studentCardPolicy";
import type { StudentCardWebIssueMedium } from "../../lib/studentCardPolicy";

interface StudentCardIssueDialogProps {
  open: boolean;
  medium: StudentCardWebIssueMedium;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function StudentCardIssueDialog({
  open,
  medium,
  pending,
  onCancel,
  onConfirm,
}: StudentCardIssueDialogProps) {
  return (
    <Modal
      open={open}
      title="Émettre une carte"
      description="Le QR sécurisé s’affichera une seule fois, le temps de l’aperçu et de l’impression."
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
            Annuler
          </Button>
          <Button type="button" onClick={onConfirm} disabled={pending}>
            {pending ? "Émission…" : "Émettre"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink">
        Support émis : {studentCardMediumLabel(medium)}. Le Web n’écrit rien sur une puce NFC.
      </p>
    </Modal>
  );
}
