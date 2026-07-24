import type { StudentGuardianViewModel } from "../../lib/studentGuardianViewModel";
import { Card, SectionHeader, EmptyState } from "../../design-system";
import { StudentGuardianBadges } from "./StudentGuardianBadges";
import { cn } from "../../lib/utils";

interface StudentGuardianTableProps {
  guardians: readonly StudentGuardianViewModel[];
}

function YesNo({ value }: { value: boolean }) {
  return (
    <span className={value ? "font-semibold text-teal" : "text-muted"}>
      {value ? "Oui" : "Non"}
    </span>
  );
}

export function StudentGuardianTable({
  guardians,
}: StudentGuardianTableProps) {
  return (
    <Card className="p-6">
      <SectionHeader
        title="Tous les responsables"
        description="Relations actives et historiques liées à l'élève."
      />

      {guardians.length === 0 ? (
        <EmptyState className="mt-6" title="Aucun responsable associé" />
      ) : (
        <>
          <div className="mt-6 hidden overflow-x-auto md:block">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">Nom</th>
                  <th className="px-3 py-2 font-semibold">Relation</th>
                  <th className="px-3 py-2 font-semibold">Téléphone</th>
                  <th className="px-3 py-2 font-semibold">Email</th>
                  <th className="px-3 py-2 font-semibold">Légal</th>
                  <th className="px-3 py-2 font-semibold">Urgence</th>
                  <th className="px-3 py-2 font-semibold">Paiement</th>
                </tr>
              </thead>
              <tbody>
                {guardians.map((guardian) => (
                  <tr
                    key={guardian.id}
                    className={cn(
                      "border-b border-line/70",
                      guardian.isPrimary && "bg-brand-50/50",
                    )}
                  >
                    <td className="px-3 py-3 font-medium text-ink">
                      {guardian.displayName}
                      {guardian.isPrimary ? (
                        <span className="ml-2 text-xs font-semibold text-brand">
                          Principal
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-ink">
                      {guardian.relationshipLabel}
                    </td>
                    <td className="px-3 py-3 text-ink">{guardian.phoneLabel}</td>
                    <td className="px-3 py-3 text-ink">{guardian.emailLabel}</td>
                    <td className="px-3 py-3">
                      <YesNo value={guardian.isLegalGuardian} />
                    </td>
                    <td className="px-3 py-3">
                      <YesNo value={guardian.isEmergencyContact} />
                    </td>
                    <td className="px-3 py-3">
                      <YesNo value={guardian.financialResponsible} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="mt-6 space-y-3 md:hidden">
            {guardians.map((guardian) => (
              <li
                key={guardian.id}
                className={cn(
                  "rounded-xl border border-line p-4",
                  guardian.isPrimary && "border-brand/40 bg-brand-50/40",
                )}
              >
                <p className="font-semibold text-ink">{guardian.displayName}</p>
                <p className="mt-1 text-sm text-muted">
                  {guardian.relationshipLabel}
                </p>
                <div className="mt-3">
                  <StudentGuardianBadges badges={guardian.badges} />
                </div>
                <dl className="mt-3 grid gap-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Téléphone</dt>
                    <dd className="font-medium text-ink">
                      {guardian.phoneLabel}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Email</dt>
                    <dd className="font-medium text-ink">
                      {guardian.emailLabel}
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
