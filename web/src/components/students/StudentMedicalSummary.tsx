import type { StudentMedicalViewModel } from "../../lib/studentMedicalViewModel";
import { Card, SectionHeader } from "../ui/Card";
import { StudentMedicalBadges } from "./StudentMedicalBadges";
import { cn } from "../../lib/utils";

interface StudentMedicalSummaryProps {
  medical: StudentMedicalViewModel;
}

export function StudentMedicalSummary({ medical }: StudentMedicalSummaryProps) {
  return (
    <Card
      className={cn(
        "p-6",
        medical.hasCriticalRisk && "border-danger/30 bg-danger/5",
      )}
      data-testid="student-medical-summary"
    >
      <SectionHeader
        title="Synthèse médicale"
        description="Informations de sécurité utilisées par l'établissement."
      />

      <div className="mt-4">
        <StudentMedicalBadges badges={medical.badges} />
      </div>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Groupe sanguin
          </dt>
          <dd className="mt-1 text-sm font-medium text-ink">
            {medical.summary.bloodTypeLabel}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Allergies critiques
          </dt>
          <dd className="mt-1 text-sm font-medium text-ink">
            {medical.summary.criticalAllergiesLabel}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Pathologies
          </dt>
          <dd className="mt-1 text-sm font-medium text-ink">
            {medical.summary.conditionsLabel}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Traitements
          </dt>
          <dd className="mt-1 text-sm font-medium text-ink">
            {medical.summary.medicationsLabel}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Médecin
          </dt>
          <dd className="mt-1 text-sm font-medium text-ink">
            {medical.summary.physicianLabel}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Dernière mise à jour
          </dt>
          <dd className="mt-1 text-sm font-medium text-ink">
            {medical.summary.lastUpdateLabel}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Vaccinations
          </dt>
          <dd className="mt-1 text-sm font-medium text-ink">
            {medical.vaccinationStatusLabel}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
