import { useStudentEditingContext } from "../../hooks/useStudentEditingContext";
import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { Card, SectionHeader } from "../ui/Card";
import { StudentEmergencyContacts } from "./StudentEmergencyContacts";
import { StudentGuardianCard } from "./StudentGuardianCard";
import { StudentGuardianTable } from "./StudentGuardianTable";
import { StudentPickupAuthorization } from "./StudentPickupAuthorization";
import { StudentEditingPanel } from "./editing/StudentEditingPanel";

interface StudentGuardiansTabProps {
  workspace: StudentWorkspaceViewModel;
}

export function StudentGuardiansTab({ workspace }: StudentGuardiansTabProps) {
  const financial = workspace.financialResponsibles[0] ?? null;
  const editing = useStudentEditingContext(workspace.studentId);

  return (
    <div className="space-y-6" data-testid="student-guardians-tab">
      <StudentGuardianCard guardian={workspace.primaryGuardian} />

      <StudentGuardianTable guardians={workspace.guardians} />

      <div className="grid gap-6 lg:grid-cols-2">
        <StudentEmergencyContacts contacts={workspace.emergencyContacts} />
        <StudentPickupAuthorization
          guardians={workspace.pickupAuthorizedGuardians}
        />
      </div>

      <Card className="p-6">
        <SectionHeader
          title="Responsable des paiements"
          description="Contact financier de référence pour la facturation future."
        />
        {financial ? (
          <div className="mt-6">
            <p className="text-lg font-bold text-ink">{financial.displayName}</p>
            <p className="mt-1 text-sm text-muted">
              {financial.relationshipLabel} · {financial.phoneLabel}
            </p>
            <p className="mt-4 text-xs text-muted">
              Plus tard : facturation, bourses, échéances
            </p>
          </div>
        ) : (
          <p className="mt-6 rounded-xl border border-dashed border-line bg-slate-50 px-4 py-8 text-center text-sm font-medium text-muted">
            Aucun responsable financier
          </p>
        )}
      </Card>

      <Card className="p-6">
        <SectionHeader
          title="Édition des coordonnées"
          description="Périmètre C1.7 : téléphone, e-mail, adresse, urgence, récupération, priorité. Pas de création/suppression ni changement de responsable légal."
        />
        <div className="mt-6">
          <StudentEditingPanel
            canUpdateIdentity={false}
            canUpdateGuardians={editing.canUpdateGuardians}
            canUpdateAdministrative={false}
            identity={null}
            guardians={editing.guardians}
            administrative={null}
            authContext={editing.authContext}
            repository={editing.repository}
            onSuccess={editing.refreshFromStore}
          />
        </div>
      </Card>
    </div>
  );
}
