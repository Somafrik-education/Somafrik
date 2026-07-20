import type { StudentEnrollmentViewModel } from "../../lib/studentEnrollmentViewModel";
import type { EnrollmentTimelineStep } from "../../lib/studentEnrollmentViewModel";
import { Card, SectionHeader } from "../ui/Card";
import { StudentEnrollmentStatusBadge } from "./StudentEnrollmentStatusBadge";
import { StudentEnrollmentTimeline } from "./StudentEnrollmentTimeline";

interface StudentCurrentEnrollmentCardProps {
  enrollment: StudentEnrollmentViewModel | null;
  timeline: readonly EnrollmentTimelineStep[];
  schoolNameLabel: string;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}

export function StudentCurrentEnrollmentCard({
  enrollment,
  timeline,
  schoolNameLabel,
}: StudentCurrentEnrollmentCardProps) {
  if (!enrollment) {
    return (
      <Card className="p-6">
        <SectionHeader
          title="Inscription actuelle"
          description="Situation scolaire de l'année en cours."
        />
        <p className="mt-6 rounded-xl border border-dashed border-line bg-slate-50 px-4 py-8 text-center text-sm font-medium text-muted">
          Aucune inscription active
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <SectionHeader
          title="Inscription actuelle"
          description="Situation scolaire de l'année en cours."
        />
        <StudentEnrollmentStatusBadge status={enrollment.status} />
      </div>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Année scolaire" value={enrollment.academicYearLabel} />
        <Field label="Établissement" value={enrollment.schoolNameLabel || schoolNameLabel} />
        <Field label="Classe" value={enrollment.classLabel} />
        <Field label="Filière / programme" value={enrollment.programLabel} />
        <Field label="Date de demande" value={enrollment.requestedAtLabel} />
        <Field label="Date de validation" value={enrollment.validatedAtLabel} />
        <Field label="Date d'inscription" value={enrollment.enrolledAtLabel} />
        <Field label="Origine" value={enrollment.sourceLabel} />
        {enrollment.hasApplicationReference ||
        enrollment.source === "PUBLIC_WEBSITE" ? (
          <Field
            label="Référence de préinscription"
            value={enrollment.applicationReferenceLabel}
          />
        ) : null}
      </dl>

      {timeline.length > 0 ? (
        <div className="mt-8 border-t border-line pt-6">
          <h3 className="text-sm font-bold text-ink">
            Progression administrative
          </h3>
          <div className="mt-4">
            <StudentEnrollmentTimeline steps={timeline} />
          </div>
        </div>
      ) : null}

      <p className="mt-8 text-xs text-muted">
        Actions administratives à venir
      </p>
    </Card>
  );
}
