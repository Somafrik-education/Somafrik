import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { Card } from "../ui/Card";
import { StudentHistoryGroups } from "./StudentHistoryGroups";
import { StudentHistorySummary } from "./StudentHistorySummary";

interface StudentHistoryTabProps {
  workspace: StudentWorkspaceViewModel;
}

export function StudentHistoryTab({ workspace }: StudentHistoryTabProps) {
  const history = workspace.historyModule;

  return (
    <div className="space-y-6" data-testid="student-history-tab">
      <StudentHistorySummary history={history} />
      <StudentHistoryGroups
        groups={history.groups}
        emptyState={history.emptyState}
      />

      <Card className="p-5">
        <p className="text-sm font-semibold text-ink">
          Actions historiques à venir
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {["Exporter", "Auditer"].map((label) => (
            <button
              key={label}
              type="button"
              disabled
              className="inline-flex min-h-10 items-center rounded-lg border border-line bg-slate-50 px-3 text-sm font-semibold text-muted opacity-60"
            >
              {label}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
