import type { StudentEnrollmentViewModel } from "../../lib/studentEnrollmentViewModel";
import { Card, SectionHeader } from "../ui/Card";
import { StudentEnrollmentStatusBadge } from "./StudentEnrollmentStatusBadge";
import { cn } from "../../lib/utils";

interface StudentEnrollmentHistoryProps {
  enrollments: readonly StudentEnrollmentViewModel[];
}

export function StudentEnrollmentHistory({
  enrollments,
}: StudentEnrollmentHistoryProps) {
  return (
    <Card className="p-6">
      <SectionHeader
        title="Parcours scolaire"
        description="Historique des inscriptions, de la plus récente à la plus ancienne."
      />

      {enrollments.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-line bg-slate-50 px-4 py-8 text-center text-sm font-medium text-muted">
          Aucune inscription enregistrée
        </p>
      ) : (
        <>
          <div className="mt-6 hidden overflow-x-auto md:block">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">Année scolaire</th>
                  <th className="px-3 py-2 font-semibold">Classe</th>
                  <th className="px-3 py-2 font-semibold">Filière</th>
                  <th className="px-3 py-2 font-semibold">Statut</th>
                  <th className="px-3 py-2 font-semibold">Origine</th>
                  <th className="px-3 py-2 font-semibold">Date d&apos;inscription</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((enrollment) => (
                  <tr
                    key={enrollment.id}
                    className={cn(
                      "border-b border-line/70",
                      enrollment.isCurrent && "bg-brand-50/60",
                    )}
                  >
                    <td className="px-3 py-3 font-medium text-ink">
                      {enrollment.academicYearLabel}
                      {enrollment.isCurrent ? (
                        <span className="ml-2 text-xs font-semibold text-brand">
                          Actuelle
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-ink">{enrollment.classLabel}</td>
                    <td className="px-3 py-3 text-ink">
                      {enrollment.programLabel}
                    </td>
                    <td className="px-3 py-3">
                      <StudentEnrollmentStatusBadge status={enrollment.status} />
                    </td>
                    <td className="px-3 py-3 text-ink">
                      {enrollment.sourceLabel}
                    </td>
                    <td className="px-3 py-3 text-ink">
                      {enrollment.enrolledAtLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="mt-6 space-y-3 md:hidden">
            {enrollments.map((enrollment) => (
              <li
                key={enrollment.id}
                className={cn(
                  "rounded-xl border border-line p-4",
                  enrollment.isCurrent && "border-brand/40 bg-brand-50/50",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">
                      {enrollment.academicYearLabel}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {enrollment.classLabel}
                    </p>
                  </div>
                  <StudentEnrollmentStatusBadge status={enrollment.status} />
                </div>
                <dl className="mt-3 grid gap-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Filière</dt>
                    <dd className="font-medium text-ink">
                      {enrollment.programLabel}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Origine</dt>
                    <dd className="font-medium text-ink">
                      {enrollment.sourceLabel}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Inscription</dt>
                    <dd className="font-medium text-ink">
                      {enrollment.enrolledAtLabel}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
