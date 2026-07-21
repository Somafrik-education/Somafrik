import type { DocumentBadge } from "../../lib/studentDocumentsViewModel";
import { Badge } from "../ui/Badge";

interface StudentDocumentBadgesProps {
  badges: readonly DocumentBadge[];
}

export function StudentDocumentBadges({ badges }: StudentDocumentBadgesProps) {
  if (badges.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2" data-testid="student-document-badges">
      {badges.map((badge) => (
        <Badge key={`${badge.kind}-${badge.label}`} tone={badge.tone}>
          {badge.label}
        </Badge>
      ))}
    </div>
  );
}
