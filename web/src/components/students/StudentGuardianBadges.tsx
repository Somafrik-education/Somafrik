import type { GuardianBadge } from "../../lib/studentGuardianViewModel";
import { Badge } from "../../design-system";

interface StudentGuardianBadgesProps {
  badges: readonly GuardianBadge[];
}

export function StudentGuardianBadges({ badges }: StudentGuardianBadgesProps) {
  if (badges.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {badges.map((badge) => (
        <Badge key={`${badge.kind}-${badge.label}`} tone={badge.tone}>
          {badge.label}
        </Badge>
      ))}
    </div>
  );
}
