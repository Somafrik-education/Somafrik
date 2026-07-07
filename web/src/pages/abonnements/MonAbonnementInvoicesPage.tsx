import { useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { findSubscriptionForSchool } from "../../lib/subscriptions";
import { ensureSubscriptionOffers, findOffer, generateInvoice } from "../../lib/subscriptionModule";
import { normalize } from "../../lib/format";
import { Card, SectionHeader } from "../../components/ui/Card";
import { StatusBadge } from "../../components/ui/Badge";
import { Table, type Column } from "../../components/ui/Table";
import { PrintButton } from "../../components/ui/PrintButton";
import type { SubscriptionInvoice } from "../../types";

export function MonAbonnementInvoicesPage() {
  const { session } = useAuth();
  const { state } = useData();
  const schoolCode = session?.user?.schoolCode ?? "";

  const subscription = findSubscriptionForSchool(state.subscriptions, schoolCode);
  const offers = ensureSubscriptionOffers(state.subscriptionOffers, state.countries);
  const offer = findOffer(offers, subscription?.offerId);

  const rows = useMemo(() => {
    const stored = (state.subscriptionInvoices ?? []).filter(
      (inv) => normalize(inv.schoolCode) === normalize(schoolCode),
    );
    if (stored.length || !subscription) return stored;
    return [generateInvoice(subscription, offer)];
  }, [state.subscriptionInvoices, schoolCode, subscription, offer]);

  const payments = (state.subscriptionPayments ?? []).filter(
    (p) => normalize(p.schoolCode) === normalize(schoolCode) && p.status === "Validé",
  );

  const columns: Column<SubscriptionInvoice>[] = [
    { key: "id", header: "Facture", render: (i) => <span className="font-mono text-xs">{i.id}</span> },
    {
      key: "amount",
      header: "Montant",
      align: "right",
      render: (i) => `${i.amount} ${i.currency}`,
    },
    { key: "period", header: "Période", render: (i) => `${i.periodStart} → ${i.periodEnd}` },
    { key: "status", header: "Statut", render: (i) => <StatusBadge status={i.status} /> },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <SectionHeader
          title="Factures & reçus"
          actions={<PrintButton documentTitle={`Factures ${schoolCode}`} />}
        />
        <div className="mt-4">
          <Table columns={columns} rows={rows} rowKey={(i) => i.id} emptyLabel="Aucune facture." />
        </div>
      </Card>

      {payments.length ? (
        <Card className="p-6">
          <SectionHeader title="Reçus de paiement" />
          <ul className="mt-3 space-y-2 text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-line px-3 py-2">
                <span className="font-mono text-xs">{p.receiptId ?? p.id}</span>
                <span>
                  {p.amount} {p.currency} — {p.validatedAt}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
