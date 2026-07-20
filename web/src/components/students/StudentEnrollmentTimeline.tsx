import type { EnrollmentTimelineStep } from "../../lib/studentEnrollmentViewModel";
import { cn } from "../../lib/utils";

interface StudentEnrollmentTimelineProps {
  steps: readonly EnrollmentTimelineStep[];
}

export function StudentEnrollmentTimeline({
  steps,
}: StudentEnrollmentTimelineProps) {
  if (steps.length === 0) {
    return null;
  }

  return (
    <ol
      className="space-y-3"
      aria-label="Progression administrative de l'inscription"
    >
      {steps.map((step, index) => (
        <li key={step.key} className="flex items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
              step.state === "completed" && "bg-teal/15 text-teal",
              step.state === "current" && "bg-brand-50 text-brand ring-2 ring-brand/30",
              step.state === "upcoming" && "bg-slate-100 text-slate-500",
            )}
            aria-hidden="true"
          >
            {index + 1}
          </span>
          <div>
            <p
              className={cn(
                "text-sm font-semibold",
                step.state === "upcoming" ? "text-muted" : "text-ink",
              )}
            >
              {step.label}
            </p>
            <p className="text-xs text-muted">
              {step.state === "completed"
                ? "Étape atteinte"
                : step.state === "current"
                  ? "Étape en cours"
                  : "À venir"}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
