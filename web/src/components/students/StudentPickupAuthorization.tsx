import type { StudentGuardianViewModel } from "../../lib/studentGuardianViewModel";
import { Card, SectionHeader, EmptyState } from "../../design-system";

interface StudentPickupAuthorizationProps {
  guardians: readonly StudentGuardianViewModel[];
}

export function StudentPickupAuthorization({
  guardians,
}: StudentPickupAuthorizationProps) {
  return (
    <Card className="p-6">
      <SectionHeader
        title="Personnes autorisées à récupérer l'élève"
        description="Liste dérivée du flag métier pickupAuthorized."
      />

      {guardians.length === 0 ? (
        <EmptyState className="mt-6" title="Aucune autorisation de récupération" />
      ) : (
        <ul className="mt-6 space-y-2">
          {guardians.map((guardian) => (
            <li
              key={guardian.id}
              className="flex items-center gap-2 text-sm font-medium text-ink"
            >
              <span className="text-teal" aria-hidden="true">
                ✓
              </span>
              <span>
                {guardian.relationshipLabel}
                <span className="text-muted"> — {guardian.displayName}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
