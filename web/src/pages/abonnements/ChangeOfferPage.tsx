import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import {
  canDowngradeToOffer,
  countActiveStudents,
  ensureSubscriptionOffers,
  filterOffersForCountry,
  findOffer,
  requestOfferChange,
} from "../../lib/subscriptionModule";
import { formatMetric, normalize } from "../../lib/format";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Select } from "../../components/ui/Field";
import { useToast } from "../../components/ui/Toast";

export function ChangeOfferPage() {
  const { session } = useAuth();
  const { state, update } = useData();
  const { showToast } = useToast();
  const [offerId, setOfferId] = useState("");
  const [busy, setBusy] = useState(false);

  const schoolCode = session?.user?.schoolCode ?? "";
  const school = state.schools.find((s) => normalize(s.code) === normalize(schoolCode));
  const offers = filterOffersForCountry(
    ensureSubscriptionOffers(state.subscriptionOffers, state.countries),
    school?.countryCode,
  ).filter((o) => o.active && !o.id.includes("TRIAL"));
  const studentCount = countActiveStudents(state, schoolCode);

  async function submit() {
    const offer = findOffer(offers, offerId);
    if (!offer) {
      showToast("Choisissez une offre", "error");
      return;
    }
    const check = canDowngradeToOffer(studentCount, offer);
    if (!check.allowed) {
      showToast(check.reason ?? "Changement refusé", "error");
      return;
    }

    setBusy(true);
    const patch = requestOfferChange(state, schoolCode, offerId, session?.user?.identifier ?? session?.user?.email);
    if (patch.error) {
      showToast(patch.error, "error");
      setBusy(false);
      return;
    }
    try {
      await update(patch);
      showToast(`Demande de passage à « ${offer.name} » enregistrée`, "success");
    } catch {
      showToast("Échec", "error");
    } finally {
      setBusy(false);
    }
  }

  const offerOptions = offers.map((o) => ({
    value: o.id,
    label: `${o.name} — ${formatMetric(o.monthlyPrice, o.currency)}/mois`,
  }));

  return (
    <Card className="p-6">
      <SectionHeader
        title="Changer d'offre"
        description={`Votre établissement compte ${studentCount} élève(s) actif(s). Un passage vers une offre inférieure peut être refusé si la limite est dépassée.`}
      />
      <div className="mt-4 max-w-md space-y-4">
        <Field label="Nouvelle offre">
          <Select
            value={offerId}
            options={[{ value: "", label: "Choisir…" }, ...offerOptions]}
            onChange={(e) => setOfferId(e.target.value)}
          />
        </Field>
        <Button disabled={busy} onClick={() => void submit()}>
          Demander le changement
        </Button>
      </div>
    </Card>
  );
}
