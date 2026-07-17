import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { Badge, StatusBadge } from "../ui/Badge";
import { Card, SectionHeader } from "../ui/Card";

interface StudentWorkspaceSummaryProps {
  workspace: StudentWorkspaceViewModel;
}

function AvailabilityBadge({
  available,
  availableLabel,
  missingLabel,
}: {
  available: boolean;
  availableLabel: string;
  missingLabel: string;
}) {
  return (
    <Badge tone={available ? "success" : "neutral"}>
      {available ? availableLabel : missingLabel}
    </Badge>
  );
}

export function StudentWorkspaceSummary({
  workspace,
}: StudentWorkspaceSummaryProps) {
  return (
    <Card className="p-6">
      <SectionHeader
        title={workspace.displayName}
        description={`Matricule : ${workspace.matriculeLabel}`}
      />

      <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Statut d'inscription
          </dt>
          <dd className="mt-2">
            <StatusBadge status={workspace.enrollmentStatusLabel} />
          </dd>
        </div>

        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Année scolaire
          </dt>
          <dd className="mt-2 font-medium">{workspace.academicYearLabel}</dd>
        </div>

        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Classe actuelle
          </dt>
          <dd className="mt-2 font-medium">{workspace.classLabel}</dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
        <AvailabilityBadge
          available={workspace.hasGuardians}
          availableLabel="Responsable renseigné"
          missingLabel="Aucun responsable"
        />
        <AvailabilityBadge
          available={workspace.hasDocuments}
          availableLabel="Documents disponibles"
          missingLabel="Aucun document"
        />
        <AvailabilityBadge
          available={workspace.hasMedicalProfile}
          availableLabel="Profil médical disponible"
          missingLabel="Aucun profil médical"
        />
      </div>
    </Card>
  );
}
