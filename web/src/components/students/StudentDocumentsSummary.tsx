import type { StudentDocumentViewModel } from "../../lib/studentDocumentsViewModel";
import { Card, SectionHeader } from "../../design-system";
import { StudentDocumentBadges } from "./StudentDocumentBadges";

interface StudentDocumentsSummaryProps {
  documents: StudentDocumentViewModel;
}

export function StudentDocumentsSummary({
  documents,
}: StudentDocumentsSummaryProps) {
  const { summary } = documents;

  return (
    <Card className="p-6" data-testid="student-documents-summary">
      <SectionHeader
        title="Documents"
        description="État de conformité administrative du dossier élève."
      />

      <div className="mt-4">
        <StudentDocumentBadges badges={documents.badges} />
      </div>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Conformité
          </dt>
          <dd className="mt-1 text-2xl font-bold text-ink">
            {documents.complianceLabel}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Vérifiés
          </dt>
          <dd className="mt-1 text-sm font-medium text-ink">{summary.verified}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            En attente
          </dt>
          <dd className="mt-1 text-sm font-medium text-ink">{summary.pending}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Expirés
          </dt>
          <dd className="mt-1 text-sm font-medium text-ink">{summary.expired}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Manquants
          </dt>
          <dd className="mt-1 text-sm font-medium text-ink">{summary.missing}</dd>
        </div>
      </dl>

    </Card>
  );
}
