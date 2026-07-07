import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { findSubscriptionForSchool } from "../../lib/subscriptions";
import { requestSubscriptionCancellation } from "../../lib/subscriptionModule";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Field";
import { useToast } from "../../components/ui/Toast";

export function CancellationRequestPage() {
  const { session } = useAuth();
  const { state, update } = useData();
  const { showToast } = useToast();
  const [reason, setReason] = useState("");
  const [timing, setTiming] = useState("end_of_period");
  const [busy, setBusy] = useState(false);

  const schoolCode = session?.user?.schoolCode ?? "";
  const subscription = findSubscriptionForSchool(state.subscriptions, schoolCode);

  async function submit() {
    if (!reason.trim()) {
      showToast("Indiquez un motif", "error");
      return;
    }
    setBusy(true);
    const patch = requestSubscriptionCancellation(
      state,
      schoolCode,
      `${reason.trim()} (${timing === "immediate" ? "immédiat" : "fin de période payée"})`,
      session?.user?.identifier ?? session?.user?.email,
    );
    try {
      await update(patch);
      showToast("Demande de résiliation enregistrée", "success");
      setReason("");
    } catch {
      showToast("Échec", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <SectionHeader
          title="Demander une résiliation"
          description="Vos données ne seront pas supprimées immédiatement. Exportez vos données avant fermeture."
        />
        {subscription?.cancellationRequestedAt ? (
          <p className="mt-4 rounded-lg bg-amber/10 px-4 py-3 text-sm text-amber">
            Demande enregistrée le {subscription.cancellationRequestedAt}.
            {subscription.cancellationReason ? ` Motif : ${subscription.cancellationReason}` : null}
          </p>
        ) : (
          <div className="mt-4 max-w-lg space-y-4">
            <Field label="Effet souhaité">
              <Select
                value={timing}
                options={[
                  { value: "end_of_period", label: "À la fin de la période payée" },
                  { value: "immediate", label: "Immédiat" },
                ]}
                onChange={(e) => setTiming(e.target.value)}
              />
            </Field>
            <Field label="Motif">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Button disabled={busy} onClick={() => void submit()}>
              Envoyer la demande
            </Button>
          </div>
        )}
      </Card>

      <Card className="p-6">
        <SectionHeader title="Conservation des données" />
        <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-muted">
          <li>0 à 30 jours après résiliation : accès lecture seule</li>
          <li>30 à 90 jours : données conservées, accès bloqué</li>
          <li>Après 90 jours : archivage ou suppression selon contrat</li>
          <li>Export des données disponible sur demande</li>
        </ul>
      </Card>
    </div>
  );
}
