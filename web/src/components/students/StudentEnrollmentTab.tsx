import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { StudentCurrentEnrollmentCard } from "./StudentCurrentEnrollmentCard";
import { StudentEnrollmentHistory } from "./StudentEnrollmentHistory";

interface StudentEnrollmentTabProps {
  workspace: StudentWorkspaceViewModel;
}

export function StudentEnrollmentTab({
  workspace,
}: StudentEnrollmentTabProps) {
  return (
    <div className="space-y-6" data-testid="student-enrollment-tab">
      <StudentCurrentEnrollmentCard
        enrollment={workspace.currentEnrollment}
        timeline={workspace.enrollmentTimeline}
        schoolNameLabel={workspace.schoolNameLabel}
      />
      <StudentEnrollmentHistory enrollments={workspace.enrollmentHistory} />
    </div>
  );
}
