import type { MedicationViewModel } from "../../lib/studentMedicalViewModel";
import { Card, SectionHeader } from "../ui/Card";
import { Badge } from "../ui/Badge";

interface StudentMedicalMedicationsProps {
  medications: readonly MedicationViewModel[];
}

export function StudentMedicalMedications({
  medications,
}: StudentMedicalMedicationsProps) {
  return (
    <Card className="p-6" data-testid="student-medical-medications">
      <SectionHeader
        title="Traitements"
        description="Médicaments connus de l'établissement."
      />

      {medications.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-line bg-slate-50 px-4 py-8 text-center text-sm font-medium text-muted">
          Aucun traitement renseigné
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {medications.map((medication) => (
            <li
              key={medication.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-line px-4 py-3"
            >
              <div>
                <p className="text-sm font-semibold text-ink">
                  {medication.label}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {medication.frequencyLabel !== "Non renseigné"
                    ? medication.frequencyLabel
                    : medication.dosageLabel}
                </p>
              </div>
              <Badge tone={medication.isActive ? "info" : "neutral"}>
                {medication.statusLabel}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
