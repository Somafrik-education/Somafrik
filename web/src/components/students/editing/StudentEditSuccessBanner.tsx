import { Button, InlineAlert } from "../../../design-system";

interface StudentEditSuccessBannerProps {
  visible: boolean;
  message?: string;
  newVersion?: number | null;
  onDismiss?: () => void;
}

export function StudentEditSuccessBanner({
  visible,
  message = "Modifications enregistrées.",
  newVersion = null,
  onDismiss,
}: StudentEditSuccessBannerProps) {
  if (!visible) return null;

  return (
    <InlineAlert
      tone="success"
      title={message}
      action={
        onDismiss ? (
          <Button type="button" variant="tertiary" size="sm" onClick={onDismiss}>
            Fermer
          </Button>
        ) : null
      }
      data-testid="student-edit-success"
    >
      {newVersion != null ? <>Nouvelle version : {newVersion}</> : null}
    </InlineAlert>
  );
}
