import type { StudentHistoryViewModel } from "../../lib/studentHistoryViewModel";
import { Card, SectionHeader } from "../../design-system";

interface StudentHistorySummaryProps {
  history: StudentHistoryViewModel;
}

export function StudentHistorySummary({ history }: StudentHistorySummaryProps) {
  const { summary } = history;

  return (
    <Card className="p-6" data-testid="student-history-summary">
      <SectionHeader
        title="Historique"
        description="Chronologie des événements significatifs du dossier."
      />

      <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Événements
          </dt>
          <dd className="mt-1 text-2xl font-bold text-ink">
            {summary.totalEvents}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Dernier événement
          </dt>
          <dd className="mt-1 text-sm font-medium text-ink">
            {history.timeline.find((event) => !event.isUndated)
              ?.occurredAtLabel ?? "Aucun"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Activité récente
          </dt>
          <dd className="mt-1 text-sm font-medium text-ink">
            {summary.hasRecentActivity ? "Oui" : "Non"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Événement important
          </dt>
          <dd className="mt-1 text-sm font-medium text-ink">
            {history.latestImportantEventLabel ?? "Aucun"}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
