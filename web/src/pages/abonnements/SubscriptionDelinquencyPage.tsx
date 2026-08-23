import { useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { scopedSchools, scopedSubscriptions } from "../../lib/scope";
import { mergeSubscriptionsWithSchools } from "../../lib/subscriptions";
import {
  DELINQUENCY_POLICY,
  applyDelinquencyPolicy,
  computeDelinquencyDays,
  enrichSubscription,
  ensureSubscriptionOffers,
  resolveAccessLevel,
  resolveLifecycleStatus,
} from "../../lib/subscriptionModule";
import { normalize } from "../../lib/format";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Badge, StatusBadge } from "../../components/ui/Badge";
import { Table, type Column } from "../../components/ui/Table";
import type { Subscription } from "../../types";

export function SubscriptionDelinquencyPage() {
  const { session } = useAuth();
  const { state } = useData();
  const user = session?.user ?? null;
  const schools = scopedSchools(user, state);
  const offers = ensureSubscriptionOffers(state.subscriptionOffers, state.countries);

  const rows = useMemo(() => {
    return mergeSubscriptionsWithSchools(
      schools,
      scopedSubscriptions(user, state),
      state.countries,
    )
      .map((sub) => {
        const school = schools.find((s) => normalize(s.code) === normalize(sub.schoolCode));
        return enrichSubscription(sub, school, state.countries, offers);
      })
      .filter((sub) => {
        const lifecycle = resolveLifecycleStatus(sub);
        const daysLate = computeDelinquencyDays(sub);
        return lifecycle === "En retard" || lifecycle === "Suspendu" || daysLate > 0;
      });
  }, [user, state, schools, offers]);

  const columns: Column<Subscription>[] = [
    { key: "schoolCode", header: "Établissement", render: (s) => <span className="font-semibold">{s.schoolCode}</span> },
    { key: "plan", header: "Offre" },
    { key: "status", header: "Statut", render: (s) => <StatusBadge status={resolveLifecycleStatus(s)} /> },
    {
      key: "daysLate",
      header: "Jours de retard",
      align: "right",
      render: (s) => {
        const days = computeDelinquencyDays(s);
        return days > 0 ? (
          <Badge tone={days >= DELINQUENCY_POLICY.suspensionDay ? "danger" : "warning"}>J+{days}</Badge>
        ) : (
          "—"
        );
      },
    },
    {
      key: "access",
      header: "Accès",
      render: (s) => {
        const level = resolveAccessLevel(applyDelinquencyPolicy(s));
        const label =
          level === "limited"
            ? "Limité (J+14)"
            : level === "blocked"
              ? "Suspendu (J+30)"
              : "Complet";
        return <Badge tone={level === "full" ? "success" : level === "limited" ? "warning" : "danger"}>{label}</Badge>;
      },
    },
    { key: "endDate", header: "Échéance" },
    { key: "suspensionReason", header: "Motif" },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <SectionHeader
          title="Politique de retard"
          description="J+3 statut « En retard » · J+7 relance administrateur · J+14 accès limité · J+30 suspension."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["J", "Rappel échéance"],
            [`J+${DELINQUENCY_POLICY.lateStatusDay}`, "En retard"],
            [`J+${DELINQUENCY_POLICY.adminRelanceDay}`, "Relance admin école"],
            [`J+${DELINQUENCY_POLICY.limitedAccessDay}`, "Accès limité"],
            [`J+${DELINQUENCY_POLICY.suspensionDay}`, "Suspension"],
          ].map(([day, label]) => (
            <div key={day} className="rounded-xl border border-line bg-slate-50 p-3">
              <p className="text-lg font-black text-brand">{day}</p>
              <p className="text-xs text-muted">{label}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <SectionHeader
          title="Retards et suspensions"
          description={`${rows.length} établissement(s) à suivre.`}
        />
        <div className="mt-4">
          <Table columns={columns} rows={rows} rowKey={(s) => s.id ?? s.schoolCode} emptyLabel="Aucun retard." />
        </div>
      </Card>

      <Card className="p-6">
        <SectionHeader title="Accès limité (J+14)" description="L'établissement peut encore consulter et payer, mais certaines actions sont bloquées." />
        <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-muted">
          <li>Connexion et consultation des données</li>
          <li>Consultation des factures et paiement de l'abonnement</li>
          <li>Export partiel des données</li>
          <li className="text-danger">Création d'élèves, annonces, notifications et modules premium bloqués</li>
        </ul>
      </Card>
    </div>
  );
}
