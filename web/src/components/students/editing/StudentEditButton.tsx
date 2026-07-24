import { Button } from "../../../design-system";

interface StudentEditButtonProps {
  canUpdate: boolean;
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}

export function StudentEditButton({
  canUpdate,
  onClick,
  label = "Modifier",
  disabled = false,
}: StudentEditButtonProps) {
  if (!canUpdate) return null;

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      data-testid="student-edit-button"
    >
      {label}
    </Button>
  );
}
