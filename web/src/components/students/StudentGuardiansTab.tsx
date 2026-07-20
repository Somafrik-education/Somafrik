import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { Card, SectionHeader } from "../ui/Card";
import { StudentEmergencyContacts } from "./StudentEmergencyContacts";
import { StudentGuardianCard } from "./StudentGuardianCard";
import { StudentGuardianTable } from "./StudentGuardianTable";
import { StudentPickupAuthorization } from "./StudentPickupAuthorization";

interface StudentGuardiansTabProps {
  workspace: StudentWorkspaceViewModel;
}

export function StudentGuardiansTab({ workspace }: StudentGuardiansTabProps) {
  const financial = workspace.financialResponsibles[0] ?? null;

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

      <Card className="p-5">
        <p className="text-sm font-semibold text-ink">
          Actions administratives à venir
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {["Ajouter", "Modifier", "Changer priorité", "Retirer"].map(
            (label) => (
              <button
                key={label}
                type="button"
                disabled
                className="inline-flex min-h-10 items-center rounded-lg border border-line bg-slate-50 px-3 text-sm font-semibold text-muted opacity-60"
              >
                {label}
              </button>
            ),
          )}
        </div>
      </Card>
    </div>
  );
}
