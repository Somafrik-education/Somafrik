import type { AllergyViewModel } from "../../lib/studentMedicalViewModel";
import { Badge, Card, EmptyState, SectionHeader } from "../../design-system";
import { cn } from "../../lib/utils";

interface StudentMedicalAllergiesProps {
  allergies: readonly AllergyViewModel[];
}

function severityTone(
  severity: AllergyViewModel["severity"],
): "danger" | "warning" | "neutral" | "info" {
  if (severity === "CRITICAL") return "danger";
  if (severity === "HIGH") return "warning";
  if (severity === "MEDIUM") return "info";
  return "neutral";
}

export function StudentMedicalAllergies({
  allergies,
}: StudentMedicalAllergiesProps) {
  return (
    <Card className="p-6" data-testid="student-medical-allergies">
      <SectionHeader
        title="Allergies"
        description="Risques allergiques connus de l'établissement."
      />

      {allergies.length === 0 ? (
        <EmptyState className="mt-6" title="Aucune allergie renseignée" />
      ) : (
        <ul className="mt-6 space-y-3">
          {allergies.map((allergy) => (
            <li
              key={allergy.id}
              className={cn(
                "flex items-start justify-between gap-3 rounded-xl border border-line px-4 py-3",
                allergy.isCritical && "border-danger/30 bg-danger/5",
              )}
            >
              <div>
                <p className="text-sm font-semibold text-ink">
                  {allergy.isCritical || allergy.severity === "HIGH"
                    ? `⚠ ${allergy.label}`
                    : allergy.label}
                </p>
              </div>
              <Badge tone={severityTone(allergy.severity)}>
                {allergy.severityLabel}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
