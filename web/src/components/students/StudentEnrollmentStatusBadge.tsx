import type { StudentEnrollmentStatus } from "../../lib/studentEnrollmentStatus";
import { getEnrollmentStatusPresentation } from "../../lib/studentEnrollmentStatus";
import { Badge } from "../../design-system";

interface StudentEnrollmentStatusBadgeProps {
  status: StudentEnrollmentStatus | null | undefined;
}

export function StudentEnrollmentStatusBadge({
  status,
}: StudentEnrollmentStatusBadgeProps) {
  const presentation = getEnrollmentStatusPresentation(status);
  return <Badge tone={presentation.tone}>{presentation.label}</Badge>;
}
