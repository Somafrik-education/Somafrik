import { useEffect, useMemo, useState } from "react";
import { useData } from "../../context/DataContext";
import { scopedCountries } from "../../lib/scope";
import { syncSubscriptionsFromSchools } from "../../lib/subscriptions";
import {
  GLOBAL_SUBSCRIPTION_POLICY,
  SUBSCRIPTION_PLAN_NAMES,
  countriesWithResolvedPolicies,
  resolveCountrySubscriptionPolicy,
  updateCountryPlanPrice,
} from "../../lib/subscriptionPolicy";
import { formatMetric } from "../../lib/format";
import { useFeaturePermissions, usePermissionContext } from "../../lib/usePermissionContext";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input } from "../../components/ui/Field";
import { useToast } from "../../components/ui/Toast";
import type { Country, CountrySubscriptionPolicy } from "../../types";

export function SubscriptionPolicySettingsPage() {
  const ctx = usePermissionContext();
  const { state, update } = useData();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Country[]>([]);
  const { canUpdate } = useFeaturePermissions("Abonnements");

  const countries = useMemo(() => scopedCountries(ctx.user, state), [ctx.user, state.countries]);

  useEffect(() => {
    setDraft(countriesWithResolvedPolicies(countries));
  }, [countries]);

  function patchCountry(countryCode: string, patch: Partial<Country>) {
    setDraft((current) =>
      current.map((country) => (country.code === countryCode ? { ...country, ...patch } : country)),
    );
  }

  function patchCountryPolicy(
    countryCode: string,
    updater: (policy: CountrySubscriptionPolicy) => CountrySubscriptionPolicy,
  ) {
    setDraft((current) =>
      current.map((country) => {
        if (country.code !== countryCode) return country;
        const policy = resolveCountrySubscriptionPolicy(country);
        return { ...country, subscriptionPolicy: updater(policy) };
      }),
    );
  }

  async function savePolicies() {
    setBusy(true);
    try {
      const nextCountries = state.countries.map((country) => {
        const edited = draft.find((item) => item.code === country.code);
        if (!edited?.subscriptionPolicy) return country;
        return {
          ...country,
          subscriptionPolicy: {
            currency:
              edited.subscriptionPolicy.currency?.trim().toUpperCase() ||
              edited.currency?.trim().toUpperCase() ||
              GLOBAL_SUBSCRIPTION_POLICY.currency,
            plans: edited.subscriptionPolicy.plans,
          },
        };
      });

      await update({
        countries: nextCountries,
        subscriptions: syncSubscriptionsFromSchools(state.schools, state.subscriptions, nextCountries),
      });
      showToast("Politique d'abonnement enregistrée", "success");
    } catch {
      showToast("Échec de l'enregistrement", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <SectionHeader
          title="Politique d'abonnement par pays"
          description="Barème appliqué aux abonnements selon le plan choisi dans la fiche établissement (Essentiel, Standard, Premium)."
        />
        <p className="mt-2 text-xs text-muted">
          Barème global Somafrik (repli si un pays n&apos;a pas de tarif personnalisé) : Essentiel{" "}
          {formatMetric(
            GLOBAL_SUBSCRIPTION_POLICY.plans.Essentiel.monthlyPrice,
            GLOBAL_SUBSCRIPTION_POLICY.currency,
          )}
          /mois · Standard{" "}
          {formatMetric(
            GLOBAL_SUBSCRIPTION_POLICY.plans.Standard.monthlyPrice,
            GLOBAL_SUBSCRIPTION_POLICY.currency,
          )}
          /mois · Premium{" "}
          {formatMetric(
            GLOBAL_SUBSCRIPTION_POLICY.plans.Premium.monthlyPrice,
            GLOBAL_SUBSCRIPTION_POLICY.currency,
          )}
          /mois
        </p>
      </Card>

      {draft.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-muted">
            Aucun pays configuré. Créez d&apos;abord un pays dans le module Plateforme → Pays.
          </p>
        </Card>
      ) : (
        draft.map((country) => {
          const policy = resolveCountrySubscriptionPolicy(country);
          return (
            <Card key={country.code} className="p-6">
              <SectionHeader
                title={country.name}
                description={`Code ISO : ${country.code}`}
              />
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Devise facturation">
                  <Input
                    value={policy.currency}
                    readOnly={!canUpdate}
                    onChange={(event) =>
                      patchCountry(country.code, {
                        subscriptionPolicy: {
                          ...policy,
                          currency: event.target.value.toUpperCase(),
                        },
                      })
                    }
                  />
                </Field>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                {SUBSCRIPTION_PLAN_NAMES.map((plan) => (
                  <div
                    key={plan}
                    className="rounded-xl border border-line/70 bg-slate-50/50 p-4"
                  >
                    <p className="text-sm font-bold text-ink">{plan}</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="Mensuel">
                        <Input
                          type="number"
                          min={0}
                          readOnly={!canUpdate}
                          value={policy.plans[plan].monthlyPrice}
                          onChange={(event) =>
                            patchCountryPolicy(country.code, (current) =>
                              updateCountryPlanPrice(current, plan, "monthlyPrice", event.target.value),
                            )
                          }
                        />
                      </Field>
                      <Field label="Annuel">
                        <Input
                          type="number"
                          min={0}
                          readOnly={!canUpdate}
                          value={policy.plans[plan].annualPrice}
                          onChange={(event) =>
                            patchCountryPolicy(country.code, (current) =>
                              updateCountryPlanPrice(current, plan, "annualPrice", event.target.value),
                            )
                          }
                        />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })
      )}

      {canUpdate && draft.length > 0 ? (
        <div className="flex justify-end">
          <Button disabled={busy} onClick={() => void savePolicies()}>
            Enregistrer la politique
          </Button>
        </div>
      ) : null}
    </div>
  );
}
