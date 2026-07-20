import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { Card, SectionHeader } from "../ui/Card";
import { StudentMedicalAllergies } from "./StudentMedicalAllergies";
import { StudentMedicalConditions } from "./StudentMedicalConditions";
import { StudentMedicalMedications } from "./StudentMedicalMedications";
import { StudentMedicalSummary } from "./StudentMedicalSummary";

interface StudentMedicalTabProps {
  workspace: StudentWorkspaceViewModel;
}

export function StudentMedicalTab({ workspace }: StudentMedicalTabProps) {
  const { medical } = workspace;

  return (
    <div className="space-y-6" data-testid="student-medical-tab">
      <StudentMedicalSummary medical={medical} />

      <div className="grid gap-6 lg:grid-cols-2">
        <StudentMedicalAllergies allergies={medical.allergies} />
        <StudentMedicalMedications medications={medical.medications} />
      </div>

      <StudentMedicalConditions
        conditions={medical.conditions}
        disabilities={medical.disabilities}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6" data-testid="student-medical-physician">
          <SectionHeader
            title="Médecin référent"
            description="Contact médical de référence."
          />
          {medical.physician ? (
            <div className="mt-6">
              <p className="text-lg font-bold text-ink">
                {medical.physician.nameLabel}
              </p>
              <p className="mt-1 text-sm text-muted">
                {medical.physician.phoneLabel}
              </p>
            </div>
          ) : (
            <p className="mt-6 rounded-xl border border-dashed border-line bg-slate-50 px-4 py-8 text-center text-sm font-medium text-muted">
              Aucun médecin référent
            </p>
          )}
        </Card>

        <Card className="p-6" data-testid="student-medical-emergency">
          <SectionHeader
            title="Consignes d'urgence"
            description="Instructions à appliquer en situation critique."
          />
          <p className="mt-6 whitespace-pre-wrap text-sm font-medium text-ink">
            {medical.emergencyInstructionsLabel}
          </p>
        </Card>
      </div>

      <Card className="p-5">
        <p className="text-sm font-semibold text-ink">
          Actions médicales à venir
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {["Modifier", "Valider", "Ajouter certificat"].map((label) => (
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
