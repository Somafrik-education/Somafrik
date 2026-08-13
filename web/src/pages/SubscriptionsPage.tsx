import { useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { scopedSchools, scopedSubscriptions } from "../lib/scope";
import { mergeSubscriptionsWithSchools, resolveSubscriptionPlan } from "../lib/subscriptions";
import { formatMetric, normalize } from "../lib/format";
import { useFeaturePermissions } from "../lib/usePermissionContext";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PrintButton } from "../components/ui/PrintButton";
import { StatusBadge } from "../components/ui/Badge";
import { Table, type Column } from "../components/ui/Table";
import { useToast } from "../components/ui/Toast";
import { platformApi } from "../lib/platformApi";
import type { Subscription } from "../types";

export function SubscriptionsPage() {
  const { session } = useAuth();
  const { state, refresh } = useData();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const user = session?.user ?? null;
  const schools = scopedSchools(user, state);
  const rows = useMemo(
    () =>
      mergeSubscriptionsWithSchools(
        schools,
        scopedSubscriptions(user, state),
        state.countries,
      ),
    [user, state.schools, state.subscriptions, state.countries, schools],
  );
  const schoolByCode = useMemo(
    () => new Map(schools.map((school) => [normalize(school.code), school])),
    [schools],
  );
  const { canUpdate: canRenew } = useFeaturePermissions("Abonnements");

  async function renew(subscription: Subscription) {
    setBusy(true);
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const endDate = nextYear.toLocaleDateString("fr-FR").replace(/\//g, "-");
    const mergedRow = rows.find(
      (row) => normalize(String(row.schoolCode)) === normalize(String(subscription.schoolCode)),
    );
    const next = state.subscriptions.map((item) => {
      if (normalize(String(item.schoolCode)) !== normalize(String(subscription.schoolCode))) {
        return item;
      }
      return {
        ...(mergedRow ?? item),
        status: "Actif",
        paymentStatus: "À jour",
        endDate,
      };
    });
    if (!next.some((item) => normalize(String(item.schoolCode)) === normalize(String(subscription.schoolCode)))) {
      next.push({
        ...(mergedRow ?? subscription),
        status: "Actif",
        paymentStatus: "À jour",
        endDate,
      });
    }
    try {
      const target = mergedRow ?? subscription;
      await platformApi.upsertSubscription({
        ...target,
        schoolCode: subscription.schoolCode,
        status: "Actif",
        paymentStatus: "À jour",
        endDate,
      });
      await refresh();
      showToast("Abonnement renouvelé", "success");
    } catch {
      showToast("Échec du renouvellement", "error");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Subscription>[] = [
    {
      key: "schoolCode",
      header: "Établissement",
      render: (s) => <span className="font-semibold">{s.schoolCode}</span>,
    },
    { key: "country", header: "Pays" },
    {
      key: "plan",
      header: "Plan",
      render: (s) => resolveSubscriptionPlan(schoolByCode.get(normalize(s.schoolCode)), s) || "—",
    },
    {
      key: "monthlyPrice",
      header: "Mensuel",
      align: "right",
      render: (s) => formatMetric(Number(s.monthlyPrice ?? 0), s.currency ?? "USD"),
    },
    {
      key: "annualPrice",
      header: "Annuel",
      align: "right",
      render: (s) => formatMetric(Number(s.annualPrice ?? 0), s.currency ?? "USD"),
    },
    { key: "paymentStatus", header: "Paiement", render: (s) => <StatusBadge status={s.paymentStatus} /> },
    { key: "endDate", header: "Échéance" },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (s) =>
        canRenew ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void renew(s)}>
            Renouveler
          </Button>
        ) : null,
    },
  ];

  return (
    <Card className="p-6">
      <SectionHeader
        title="Abonnements"
        description={`${rows.length} abonnement(s) suivis dans votre périmètre. Tarifs définis dans Paramètres → Politique d'abonnement par pays.`}
        actions={<PrintButton documentTitle="Abonnements — Somafrik" />}
      />
      <div className="mt-4">
        <Table columns={columns} rows={rows} rowKey={(s) => s.id ?? s.schoolCode} />
      </div>
    </Card>
  );
}
