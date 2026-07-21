import type { StudentHistoryGroupViewModel } from "../../lib/studentHistoryViewModel";
import { Card, SectionHeader } from "../ui/Card";
import { StudentHistoryTimeline } from "./StudentHistoryTimeline";

interface StudentHistoryGroupsProps {
  groups: readonly StudentHistoryGroupViewModel[];
  emptyState: string;
}

export function StudentHistoryGroups({
  groups,
  emptyState,
}: StudentHistoryGroupsProps) {
  if (groups.length === 0) {
    return (
      <Card className="p-6" data-testid="student-history-groups">
        <SectionHeader
          title="Chronologie"
          description="Événements regroupés par période."
        />
        <p className="mt-6 rounded-xl border border-dashed border-line bg-slate-50 px-4 py-8 text-center text-sm font-medium text-muted">
          {emptyState}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="student-history-groups">
      {groups.map((group) => (
        <Card key={group.key} className="p-6">
          <SectionHeader title={group.label} />
          <div className="mt-6">
            <StudentHistoryTimeline events={group.events} />
          </div>
        </Card>
      ))}
    </div>
  );
}
