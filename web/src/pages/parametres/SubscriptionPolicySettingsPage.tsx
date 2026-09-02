import { useEffect, useMemo, useState } from "react";
import { useData } from "../../context/DataContext";
import { scopedCountries } from "../../lib/scope";
import { platformApi } from "../../lib/platformApi";
import {
  GLOBAL_SUBSCRIPTION_POLICY,
  SUBSCRIPTION_PLAN_NAMES,
  countriesWithResolvedPolicies,
  resolveCountrySubscriptionPolicy,
  updateCountryPlanPrice,
} from "../../lib/subscriptionPolicy";
import { formatMetric } from "../../lib/format";
import { useFeaturePermissions, usePermissionContext } from "../../lib/usePermissionContext";
import {
  Button,
  Card,
  EmptyState,
  FormField,
  FormLayout,
  Input,
  SectionHeader,
  useToast,
} from "../../design-system";
import type { Country, CountrySubscriptionPolicy } from "../../types";

export function SubscriptionPolicySettingsPage() {
  const ctx = usePermissionContext();
  const { state, refresh } = useData();
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

      for (const country of nextCountries) {
        const edited = draft.find((item) => item.code === country.code);
        if (!edited?.subscriptionPolicy) continue;
        await platformApi.updateCountry(country.code, {
          subscriptionPolicy: {
            currency:
              edited.subscriptionPolicy.currency?.trim().toUpperCase() ||
              edited.currency?.trim().toUpperCase() ||
              GLOBAL_SUBSCRIPTION_POLICY.currency,
            plans: edited.subscriptionPolicy.plans,
          },
        });
      }
      await refresh();
      showToast("Politique d'abonnement enregistrée", "success");
    } catch {
      showToast("Échec de l'enregistrement", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormLayout>
      <FormLayout.Header>
        <SectionHeader
          title="Politique d'abonnement par pays"
          description="Barème appliqué aux abonnements selon le plan choisi dans la fiche établissement (Essentiel, Standard, Premium)."
        />
      </FormLayout.Header>
      <FormLayout.Description>
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
      </FormLayout.Description>

      <FormLayout.Content>
        {draft.length === 0 ? (
          <EmptyState
            title="Aucun pays configuré"
            description="Créez d'abord un pays dans le module Plateforme → Pays."
          />
        ) : (
          <div className="space-y-5">
            {draft.map((country) => {
              const policy = resolveCountrySubscriptionPolicy(country);
              return (
                <Card key={country.code} className="p-6">
                  <SectionHeader title={country.name} description={`Code ISO : ${country.code}`} />
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <FormField label="Devise facturation" htmlFor={`currency-${country.code}`}>
                      <Input
                        id={`currency-${country.code}`}
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
                    </FormField>
                  </div>
                  <div className="mt-4 grid gap-4 lg:grid-cols-3">
                    {SUBSCRIPTION_PLAN_NAMES.map((plan) => (
                      <div
                        key={plan}
                        className="rounded-xl border border-line/70 bg-slate-50/50 p-4"
                      >
                        <p className="text-sm font-bold text-ink">{plan}</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <FormField
                            label="Mensuel"
                            htmlFor={`monthly-${country.code}-${plan}`}
                          >
                            <Input
                              id={`monthly-${country.code}-${plan}`}
                              type="number"
                              min={0}
                              readOnly={!canUpdate}
                              value={policy.plans[plan].monthlyPrice}
                              onChange={(event) =>
                                patchCountryPolicy(country.code, (current) =>
                                  updateCountryPlanPrice(
                                    current,
                                    plan,
                                    "monthlyPrice",
                                    event.target.value,
                                  ),
                                )
                              }
                            />
                          </FormField>
                          <FormField label="Annuel" htmlFor={`annual-${country.code}-${plan}`}>
                            <Input
                              id={`annual-${country.code}-${plan}`}
                              type="number"
                              min={0}
                              readOnly={!canUpdate}
                              value={policy.plans[plan].annualPrice}
                              onChange={(event) =>
                                patchCountryPolicy(country.code, (current) =>
                                  updateCountryPlanPrice(
                                    current,
                                    plan,
                                    "annualPrice",
                                    event.target.value,
                                  ),
                                )
                              }
                            />
                          </FormField>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </FormLayout.Content>

      {canUpdate && draft.length > 0 ? (
        <FormLayout.StickyActions>
          <div className="flex justify-end">
            <Button type="button" disabled={busy} onClick={() => void savePolicies()}>
              Enregistrer la politique
            </Button>
          </div>
        </FormLayout.StickyActions>
      ) : null}
    </FormLayout>
  );
}
