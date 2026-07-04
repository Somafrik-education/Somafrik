import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { scopedSubscriptions } from "../lib/scope";
import { formatMetric } from "../lib/format";
import { useFeaturePermissions } from "../lib/usePermissionContext";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PrintButton } from "../components/ui/PrintButton";
import { StatusBadge } from "../components/ui/Badge";
import { Table, type Column } from "../components/ui/Table";
import { useToast } from "../components/ui/Toast";
import type { Subscription } from "../types";

export function SubscriptionsPage() {
  const { session } = useAuth();
  const { state, update } = useData();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const rows = scopedSubscriptions(session?.user ?? null, state);
  const { canUpdate: canRenew } = useFeaturePermissions("Abonnements");

  async function renew(subscription: Subscription) {
    setBusy(true);
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const endDate = nextYear.toLocaleDateString("fr-FR").replace(/\//g, "-");
    const next = state.subscriptions.map((s) =>
      s.id === subscription.id
        ? { ...s, status: "Actif", paymentStatus: "À jour", endDate }
        : s,
    );
    try {
      await update({ subscriptions: next });
      showToast("Abonnement renouvelé", "success");
    } catch {
      showToast("Échec du renouvellement", "error");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Subscription>[] = [
    { key: "schoolCode", header: "Établissement", render: (s) => <span className="font-semibold">{s.schoolCode}</span> },
    { key: "country", header: "Pays" },
    { key: "plan", header: "Plan" },
    {
      key: "monthlyPrice",
      header: "Mensuel",
      align: "right",
      render: (s) => formatMetric(Number(s.monthlyPrice ?? 0), s.currency ?? "USD"),
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
        description={`${rows.length} abonnement(s) suivis dans votre périmètre.`}
        actions={<PrintButton documentTitle="Abonnements — Somafrik" />}
      />
      <div className="mt-4">
        <Table columns={columns} rows={rows} rowKey={(s) => s.id ?? s.schoolCode} />
      </div>
    </Card>
  );
}
