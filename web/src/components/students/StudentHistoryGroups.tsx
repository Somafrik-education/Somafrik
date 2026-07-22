import type { StudentHistoryGroupViewModel } from "../../lib/studentHistoryViewModel";
import { Card, SectionHeader, EmptyState } from "../../design-system";
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
        <EmptyState className="mt-6" title={emptyState} />
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
