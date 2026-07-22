import type {
  ConditionViewModel,
  DisabilityViewModel,
} from "../../lib/studentMedicalViewModel";
import { Badge, Card, EmptyState, SectionHeader } from "../../design-system";
import { cn } from "../../lib/utils";

interface StudentMedicalConditionsProps {
  conditions: readonly ConditionViewModel[];
  disabilities: readonly DisabilityViewModel[];
}

function conditionTone(
  severity: ConditionViewModel["severity"],
): "danger" | "warning" | "success" {
  if (severity === "CRITICAL") return "danger";
  if (severity === "MONITORED") return "warning";
  return "success";
}

export function StudentMedicalConditions({
  conditions,
  disabilities,
}: StudentMedicalConditionsProps) {
  return (
    <div className="space-y-6">
      <Card className="p-6" data-testid="student-medical-conditions">
        <SectionHeader
          title="Pathologies"
          description="Conditions chroniques à prendre en compte."
        />

        {conditions.length === 0 ? (
          <EmptyState className="mt-6" title="Aucune pathologie renseignée" />
        ) : (
          <ul className="mt-6 space-y-3">
            {conditions.map((condition) => (
              <li
                key={condition.id}
                className={cn(
                  "flex items-start justify-between gap-3 rounded-xl border border-line px-4 py-3",
                  condition.isCritical && "border-danger/30 bg-danger/5",
                )}
              >
                <p className="text-sm font-semibold text-ink">
                  {condition.label}
                </p>
                <Badge tone={conditionTone(condition.severity)}>
                  {condition.severityLabel}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-6" data-testid="student-medical-disabilities">
        <SectionHeader
          title="Handicap"
          description="Aménagements et besoins particuliers."
        />

        {disabilities.length === 0 ? (
          <EmptyState className="mt-6" title="Aucun handicap renseigné" />
        ) : (
          <ul className="mt-6 space-y-3">
            {disabilities.map((disability) => (
              <li
                key={disability.id}
                className="rounded-xl border border-line px-4 py-3"
              >
                <p className="text-sm font-semibold text-ink">
                  {disability.typeLabel}
                </p>
                <p className="mt-1 text-sm text-muted">{disability.label}</p>
                <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  {disability.accommodationLabel}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
