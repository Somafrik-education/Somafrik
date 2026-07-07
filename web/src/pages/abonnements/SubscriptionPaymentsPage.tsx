import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { scopedSchools } from "../../lib/scope";
import {
  PAYMENT_METHODS,
  registerManualPayment,
  validateSubscriptionPayment,
} from "../../lib/subscriptionModule";
import { normalize } from "../../lib/format";
import { useFeaturePermissions } from "../../lib/usePermissionContext";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { StatusBadge } from "../../components/ui/Badge";
import { Field, Input, Select } from "../../components/ui/Field";
import { Table, type Column } from "../../components/ui/Table";
import { useToast } from "../../components/ui/Toast";
import type { SubscriptionPayment } from "../../types";

export function SubscriptionPaymentsPage() {
  const { session } = useAuth();
  const { state, update } = useData();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const { canCreate, canUpdate } = useFeaturePermissions("Abonnements");

  const user = session?.user ?? null;
  const schools = scopedSchools(user, state);
  const schoolCodes = new Set(schools.map((s) => normalize(s.code)));

  const payments = useMemo(
    () =>
      (state.subscriptionPayments ?? []).filter((p) =>
        schoolCodes.has(normalize(p.schoolCode)),
      ),
    [state.subscriptionPayments, schoolCodes],
  );

  const [form, setForm] = useState({
    schoolCode: "",
    amount: "",
    currency: "EUR",
    method: "Paiement manuel",
    reference: "",
    notes: "",
  });

  async function registerPayment() {
    if (!form.schoolCode || !form.reference.trim() || !form.amount) {
      showToast("Remplissez établissement, montant et référence", "error");
      return;
    }
    setBusy(true);
    const patch = registerManualPayment(state, {
      schoolCode: form.schoolCode,
      amount: Number(form.amount),
      currency: form.currency,
      method: form.method,
      reference: form.reference.trim(),
      notes: form.notes,
      author: user?.identifier ?? user?.email,
    });
    try {
      await update(patch);
      setForm({ ...form, reference: "", amount: "", notes: "" });
      showToast("Paiement enregistré — en attente de validation", "success");
    } catch {
      showToast("Échec", "error");
    } finally {
      setBusy(false);
    }
  }

  async function validate(payment: SubscriptionPayment) {
    setBusy(true);
    const patch = validateSubscriptionPayment(
      state,
      payment.id,
      user?.identifier ?? user?.email ?? "Admin",
    );
    try {
      await update(patch);
      showToast("Paiement validé — abonnement réactivé", "success");
    } catch {
      showToast("Échec de la validation", "error");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<SubscriptionPayment>[] = [
    { key: "schoolCode", header: "Établissement", render: (p) => <span className="font-semibold">{p.schoolCode}</span> },
    {
      key: "amount",
      header: "Montant",
      align: "right",
      render: (p) => `${p.amount} ${p.currency}`,
    },
    { key: "method", header: "Mode" },
    { key: "reference", header: "Référence" },
    { key: "status", header: "Statut", render: (p) => <StatusBadge status={p.status} /> },
    { key: "createdAt", header: "Date" },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (p) =>
        canUpdate && p.status === "En attente" ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void validate(p)}>
            Valider
          </Button>
        ) : p.receiptId ? (
          <span className="text-xs text-muted">{p.receiptId}</span>
        ) : null,
    },
  ];

  const schoolOptions = schools.map((s) => ({ value: s.code, label: s.code }));

  return (
    <div className="space-y-4">
      {canCreate ? (
        <Card className="p-6">
          <SectionHeader
            title="Enregistrer un paiement manuel"
            description="Mobile Money, virement, espèces chez un partenaire — validation admin requise."
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Établissement">
              <Select
                value={form.schoolCode}
                options={[{ value: "", label: "Choisir…" }, ...schoolOptions]}
                onChange={(e) => setForm({ ...form, schoolCode: e.target.value })}
              />
            </Field>
            <Field label="Montant">
              <Input
                type="number"
                min={0}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </Field>
            <Field label="Devise">
              <Input
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              />
            </Field>
            <Field label="Mode de paiement">
              <Select
                value={form.method}
                options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))}
                onChange={(e) => setForm({ ...form, method: e.target.value })}
              />
            </Field>
            <Field label="Référence unique *">
              <Input
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
              />
            </Field>
            <Field label="Notes">
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <div className="mt-4">
            <Button disabled={busy} onClick={() => void registerPayment()}>
              Enregistrer le paiement
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="p-6">
        <SectionHeader title="Historique des paiements" description="Toute validation est historisée." />
        <div className="mt-4">
          <Table columns={columns} rows={payments} rowKey={(p) => p.id} emptyLabel="Aucun paiement enregistré." />
        </div>
      </Card>
    </div>
  );
}
