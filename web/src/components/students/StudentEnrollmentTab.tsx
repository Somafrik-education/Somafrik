import { useStudentEditingContext } from "../../hooks/useStudentEditingContext";
import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { StudentCurrentEnrollmentCard } from "./StudentCurrentEnrollmentCard";
import { StudentEnrollmentActions } from "./StudentEnrollmentActions";
import { StudentEnrollmentHistory } from "./StudentEnrollmentHistory";

interface StudentEnrollmentTabProps {
  workspace: StudentWorkspaceViewModel;
}

export function StudentEnrollmentTab({
  workspace,
}: StudentEnrollmentTabProps) {
  const editing = useStudentEditingContext(workspace.studentId);

  const currentEditable =
    editing.enrollments.find(
      (item) => item.enrollmentId === workspace.currentEnrollment?.id,
    ) ??
    editing.enrollments[0] ??
    null;

  return (
    <div className="space-y-6" data-testid="student-enrollment-tab">
      <StudentCurrentEnrollmentCard
        enrollment={workspace.currentEnrollment}
        timeline={workspace.enrollmentTimeline}
        schoolNameLabel={workspace.schoolNameLabel}
        actions={
          <StudentEnrollmentActions
            enrollment={currentEditable}
            schoolClasses={editing.schoolClasses}
            canValidate={editing.canValidateEnrollment}
            canAssignClass={editing.canAssignEnrollmentClass}
            canTransfer={editing.canTransferEnrollment}
            canClose={editing.canCloseEnrollment}
            authContext={editing.authContext}
            repository={editing.repository}
            onSuccess={editing.refreshFromStore}
          />
        }
      />
      <StudentEnrollmentHistory enrollments={workspace.enrollmentHistory} />
    </div>
  );
}
