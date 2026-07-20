import type { MedicalBadge } from "../../lib/studentMedicalViewModel";
import { Badge } from "../ui/Badge";

interface StudentMedicalBadgesProps {
  badges: readonly MedicalBadge[];
}

export function StudentMedicalBadges({ badges }: StudentMedicalBadgesProps) {
  if (badges.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2" data-testid="student-medical-badges">
      {badges.map((badge) => (
        <Badge key={`${badge.kind}-${badge.label}`} tone={badge.tone}>
          {badge.label}
        </Badge>
      ))}
    </div>
  );
}
