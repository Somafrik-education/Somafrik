import { useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { scopedSchools, scopedSubscriptions } from "../../lib/scope";
import { mergeSubscriptionsWithSchools } from "../../lib/subscriptions";
import { ensureSubscriptionOffers, findOffer, generateInvoice } from "../../lib/subscriptionModule";
import { normalize } from "../../lib/format";
import { Card, SectionHeader } from "../../components/ui/Card";
import { StatusBadge } from "../../components/ui/Badge";
import { Table, type Column } from "../../components/ui/Table";
import { PrintButton } from "../../components/ui/PrintButton";
import type { SubscriptionInvoice } from "../../types";

export function SubscriptionInvoicesPage() {
  const { session } = useAuth();
  const { state } = useData();
  const user = session?.user ?? null;
  const schools = scopedSchools(user, state);
  const schoolCodes = new Set(schools.map((s) => normalize(s.code)));
  const offers = ensureSubscriptionOffers(state.subscriptionOffers, state.countries);

  const stored = (state.subscriptionInvoices ?? []).filter((inv) =>
    schoolCodes.has(normalize(inv.schoolCode)),
  );

  const derived = useMemo(() => {
    const subs = mergeSubscriptionsWithSchools(
      schools,
      scopedSubscriptions(user, state),
      state.countries,
    );
    const generated: SubscriptionInvoice[] = [];
    for (const sub of subs) {
      if (stored.some((inv) => normalize(inv.schoolCode) === normalize(sub.schoolCode))) continue;
      const offer = findOffer(offers, sub.offerId);
      generated.push(generateInvoice(sub, offer));
    }
    return generated;
  }, [schools, state, stored, offers, user]);

  const rows = [...stored, ...derived];

  const columns: Column<SubscriptionInvoice>[] = [
    { key: "id", header: "N° facture", render: (i) => <span className="font-mono text-xs">{i.id}</span> },
    { key: "schoolCode", header: "Établissement", render: (i) => <span className="font-semibold">{i.schoolCode}</span> },
    {
      key: "amount",
      header: "Montant",
      align: "right",
      render: (i) => `${i.amount} ${i.currency}`,
    },
    { key: "period", header: "Période", render: (i) => `${i.periodStart} → ${i.periodEnd}` },
    { key: "dueDate", header: "Échéance" },
    { key: "status", header: "Statut", render: (i) => <StatusBadge status={i.status} /> },
    { key: "issuedAt", header: "Émise le" },
  ];

  return (
    <Card className="p-6">
      <SectionHeader
        title="Factures"
        description="Les factures émises ne sont pas modifiables après émission. Téléchargez ou imprimez pour archivage."
        actions={<PrintButton documentTitle="Factures abonnements — Somafrik" />}
      />
      <div className="mt-4">
        <Table columns={columns} rows={rows} rowKey={(i) => i.id} emptyLabel="Aucune facture." />
      </div>
    </Card>
  );
}
