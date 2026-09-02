import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { scopedSchools } from "../../lib/scope";
import { platformApi } from "../../lib/platformApi";
import { normalize } from "../../lib/format";
import { useFeaturePermissions } from "../../lib/usePermissionContext";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { StatusBadge } from "../../components/ui/Badge";
import { Field, Input, Select } from "../../components/ui/Field";
import { Table, type Column } from "../../components/ui/Table";
import { useToast } from "../../components/ui/Toast";
import type { SubscriptionDiscount } from "../../types";

export function SubscriptionDiscountsPage() {
  const { session } = useAuth();
  const { state, refresh } = useData();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const { canCreate, canUpdate } = useFeaturePermissions("Abonnements");

  const user = session?.user ?? null;
  const schools = scopedSchools(user, state);
  const schoolCodes = new Set(schools.map((s) => normalize(s.code)));

  const discounts = useMemo(
    () =>
      (state.subscriptionDiscounts ?? []).filter(
        (d) => !d.schoolCode || schoolCodes.has(normalize(d.schoolCode)),
      ),
    [state.subscriptionDiscounts, schoolCodes],
  );

  const [form, setForm] = useState({
    schoolCode: "",
    percent: "10",
    reason: "",
  });

  async function proposeDiscount() {
    if (!form.schoolCode || !form.reason.trim()) {
      showToast("Établissement et motif requis", "error");
      return;
    }
    setBusy(true);
    const discount: SubscriptionDiscount = {
      id: `SDISC-${Date.now()}`,
      schoolCode: form.schoolCode,
      percent: Number(form.percent),
      reason: form.reason.trim(),
      requestedBy: user?.identifier ?? user?.email,
      status: "En attente",
      createdAt: new Date().toLocaleString("fr-FR"),
    };
    try {
      await platformApi.createSubscriptionDiscount(discount as unknown as Record<string, unknown>);
      await refresh();
      setForm({ ...form, reason: "" });
      showToast("Remise proposée — validation du Super administrateur requise", "success");
    } catch {
      showToast("Échec", "error");
    } finally {
      setBusy(false);
    }
  }

  async function approve(discount: SubscriptionDiscount) {
    setBusy(true);
    try {
      await platformApi.patchSubscriptionDiscount(discount.id, {
        status: "Approuvée",
        approvedBy: user?.identifier ?? user?.email,
      });
      await refresh();
      showToast("Remise approuvée", "success");
    } catch {
      showToast("Échec", "error");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<SubscriptionDiscount>[] = [
    { key: "schoolCode", header: "Établissement" },
    {
      key: "value",
      header: "Remise",
      render: (d) => (d.percent ? `${d.percent} %` : d.amount ? `${d.amount}` : "—"),
    },
    { key: "reason", header: "Motif" },
    { key: "requestedBy", header: "Demandeur" },
    { key: "status", header: "Statut", render: (d) => <StatusBadge status={d.status} /> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (d) =>
        canUpdate && d.status === "En attente" ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void approve(d)}>
            Approuver
          </Button>
        ) : null,
    },
  ];

  const schoolOptions = schools.map((s) => ({ value: s.code, label: s.code }));

  return (
    <div className="space-y-4">
      {canCreate ? (
        <Card className="p-6">
          <SectionHeader
            title="Proposer une remise"
            description="L'Admin Pays peut proposer ; le Super Admin valide l'application."
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Établissement" required>
              <Select
                value={form.schoolCode}
                options={[{ value: "", label: "Choisir…" }, ...schoolOptions]}
                onChange={(e) => setForm({ ...form, schoolCode: e.target.value })}
                required
              />
            </Field>
            <Field label="Pourcentage">
              <Input
                type="number"
                min={1}
                max={100}
                value={form.percent}
                onChange={(e) => setForm({ ...form, percent: e.target.value })}
              />
            </Field>
            <Field label="Motif" required>
              <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
            </Field>
          </div>
          <div className="mt-4">
            <Button disabled={busy} onClick={() => void proposeDiscount()}>
              Proposer
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="p-6">
        <SectionHeader title="Remises" description="Historique et statut des remises exceptionnelles." />
        <div className="mt-4">
          <Table columns={columns} rows={discounts} rowKey={(d) => d.id} emptyLabel="Aucune remise." />
        </div>
      </Card>
    </div>
  );
}
