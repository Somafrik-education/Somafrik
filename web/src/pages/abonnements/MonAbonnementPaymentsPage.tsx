import { useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { normalize } from "../../lib/format";
import { Card, SectionHeader } from "../../components/ui/Card";
import { StatusBadge } from "../../components/ui/Badge";
import { Table, type Column } from "../../components/ui/Table";
import type { SubscriptionPayment } from "../../types";

export function MonAbonnementPaymentsPage() {
  const { session } = useAuth();
  const { state } = useData();
  const schoolCode = session?.user?.schoolCode ?? "";

  const rows = useMemo(
    () =>
      (state.subscriptionPayments ?? []).filter(
        (p) => normalize(p.schoolCode) === normalize(schoolCode),
      ),
    [state.subscriptionPayments, schoolCode],
  );

  const columns: Column<SubscriptionPayment>[] = [
    { key: "reference", header: "Référence" },
    {
      key: "amount",
      header: "Montant",
      align: "right",
      render: (p) => `${p.amount} ${p.currency}`,
    },
    { key: "method", header: "Mode" },
    { key: "status", header: "Statut", render: (p) => <StatusBadge status={p.status} /> },
    { key: "createdAt", header: "Date" },
  ];

  return (
    <Card className="p-6">
      <SectionHeader
        title="Paiements"
        description="Historique des paiements d'abonnement. Les paiements manuels sont validés par Somafrik."
      />
      <div className="mt-4">
        <Table columns={columns} rows={rows} rowKey={(p) => p.id} emptyLabel="Aucun paiement." />
      </div>
    </Card>
  );
}
