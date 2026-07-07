import { useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { findSubscriptionForSchool } from "../../lib/subscriptions";
import {
  ensureSubscriptionOffers,
  enrichSubscription,
  findOfferForSubscription,
  formatBillingCycle,
  resolveAccessLevel,
  resolveLifecycleStatus,
  SUBSCRIPTION_MODULE_LABELS,
} from "../../lib/subscriptionModule";
import { formatMetric } from "../../lib/format";
import { Card, SectionHeader } from "../../components/ui/Card";
import { StatusBadge, Badge } from "../../components/ui/Badge";

export function MonAbonnementPage() {
  const { session } = useAuth();
  const { state } = useData();
  const schoolCode = session?.user?.schoolCode ?? "";
  const school = state.schools.find((s) => s.code === schoolCode);
  const raw = findSubscriptionForSchool(state.subscriptions, schoolCode);
  const offers = ensureSubscriptionOffers(state.subscriptionOffers, state.countries);

  const subscription = useMemo(() => {
    if (!raw && !school?.subscriptionPlan) return null;
    const base = raw ?? {
      id: `SUB-${schoolCode}`,
      schoolCode,
      plan: school?.subscriptionPlan,
      paymentStatus: school?.subscriptionStatus,
      endDate: school?.subscriptionEndDate,
    };
    return enrichSubscription(base, school, state.countries, offers);
  }, [raw, school, schoolCode, state, offers]);

  const offer = findOfferForSubscription(offers, subscription ?? {}, school);

  if (!subscription) {
    return (
      <Card className="p-6">
        <SectionHeader
          title="Mon abonnement"
          description="Aucun abonnement actif pour cet établissement. Contactez Somafrik ou votre Admin Pays."
        />
      </Card>
    );
  }

  const access = resolveAccessLevel(subscription);
  const accessLabel =
    access === "full"
      ? "Accès complet"
      : access === "limited"
        ? "Accès limité — régularisez votre paiement"
        : access === "readonly"
          ? "Lecture seule"
          : "Accès bloqué";

  return (
    <div className="space-y-4">
      {access !== "full" ? (
        <Card className="border-amber/30 bg-amber/5 p-4">
          <p className="text-sm font-semibold text-amber">
            {accessLabel}. Veuillez contacter l'administration ou régulariser votre abonnement.
          </p>
        </Card>
      ) : null}

      <Card className="p-6">
        <SectionHeader title="Mon abonnement Somafrik" description={`Établissement ${schoolCode}`} />
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase text-muted">Offre</dt>
            <dd className="mt-1 font-semibold text-ink">{offer?.name ?? subscription.plan ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted">Statut</dt>
            <dd className="mt-1">
              <StatusBadge status={resolveLifecycleStatus(subscription)} />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted">Paiement</dt>
            <dd className="mt-1">
              <StatusBadge status={subscription.paymentStatus} />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted">Facturation</dt>
            <dd className="mt-1">{formatBillingCycle(subscription.billingCycle)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted">Montant</dt>
            <dd className="mt-1 font-semibold">
              {formatMetric(Number(subscription.monthlyPrice ?? 0), subscription.currency ?? "EUR")} / mois
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted">Prochaine échéance</dt>
            <dd className="mt-1">{subscription.endDate ?? subscription.nextRenewalDate ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted">Mode de paiement</dt>
            <dd className="mt-1">{subscription.paymentMethod ?? "Paiement manuel"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted">Limite élèves</dt>
            <dd className="mt-1">
              {subscription.maxStudents == null ? "Illimité" : subscription.maxStudents}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted">Accès</dt>
            <dd className="mt-1">
              <Badge tone={access === "full" ? "success" : access === "limited" ? "warning" : "danger"}>
                {accessLabel}
              </Badge>
            </dd>
          </div>
        </dl>
      </Card>

      {offer ? (
        <Card className="p-6">
          <SectionHeader title="Modules inclus" />
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {Object.entries(SUBSCRIPTION_MODULE_LABELS).map(([key, label]) => {
              const mod = offer.modules[key];
              const included = mod === true || mod === "limited";
              return (
                <li key={key} className="flex items-center gap-2 text-sm">
                  <span className={included ? "text-teal" : "text-muted"}>{included ? "✓" : "—"}</span>
                  <span className={included ? "text-ink" : "text-muted"}>
                    {label}
                    {mod === "limited" ? " (limité)" : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
