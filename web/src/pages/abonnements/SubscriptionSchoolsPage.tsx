import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { scopedSchools, scopedSubscriptions } from "../../lib/scope";
import { mergeSubscriptionsWithSchools } from "../../lib/subscriptions";
import {
  appendSubscriptionAudit,
  createSubscriptionFromOffer,
  ensureSubscriptionOffers,
  enrichSubscription,
  filterOffersForCountry,
  findOffer,
  isOfferEligibleForCountry,
  resolveAccessLevel,
  resolveLifecycleStatus,
} from "../../lib/subscriptionModule";
import { formatMetric, normalize } from "../../lib/format";
import { useFeaturePermissions } from "../../lib/usePermissionContext";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { PrintButton } from "../../components/ui/PrintButton";
import { StatusBadge, Badge } from "../../components/ui/Badge";
import { Field, Select } from "../../components/ui/Field";
import { Table, type Column } from "../../components/ui/Table";
import { useToast } from "../../components/ui/Toast";
import type { School, Subscription } from "../../types";

export function SubscriptionSchoolsPage() {
  const { session } = useAuth();
  const { state, update } = useData();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [assignSchool, setAssignSchool] = useState("");
  const [assignOfferId, setAssignOfferId] = useState("");
  const [startTrial, setStartTrial] = useState(false);

  const user = session?.user ?? null;
  const schools = scopedSchools(user, state);
  const schoolByCode = useMemo(
    () => new Map(schools.map((school) => [normalize(school.code), school])),
    [schools],
  );
  const allOffers = ensureSubscriptionOffers(state.subscriptionOffers, state.countries);
  const assignSchoolRow = schoolByCode.get(normalize(assignSchool));
  const assignableOffers = useMemo(
    () =>
      assignSchoolRow
        ? filterOffersForCountry(allOffers, assignSchoolRow.countryCode)
        : allOffers,
    [allOffers, assignSchoolRow],
  );
  const rows = useMemo(
    () =>
      mergeSubscriptionsWithSchools(
        schools,
        scopedSubscriptions(user, state),
        state.countries,
      ).map((sub) => {
        const school = schools.find((s) => normalize(s.code) === normalize(sub.schoolCode));
        return enrichSubscription(sub, school, state.countries, allOffers);
      }),
    [user, state, schools, allOffers],
  );
  const { canCreate, canUpdate } = useFeaturePermissions("Abonnements");

  async function assignSubscription() {
    const school = schoolByCode.get(normalize(assignSchool));
    const offer = findOffer(assignableOffers, assignOfferId);
    if (!school || !offer) {
      showToast("Sélectionnez un établissement et une offre", "error");
      return;
    }
    if (!isOfferEligibleForCountry(offer, school.countryCode)) {
      showToast("Cette offre n'est pas disponible pour le pays de l'établissement", "error");
      return;
    }

    const existing = rows.find((r) => normalize(r.schoolCode) === normalize(school.code));
    const active = existing && ["Actif", "Essai"].includes(resolveLifecycleStatus(existing));
    if (active) {
      showToast("Cet établissement a déjà un abonnement actif", "error");
      return;
    }

    setBusy(true);
    const created = createSubscriptionFromOffer(school, offer, { startTrial });
    const next = [
      ...state.subscriptions.filter((s) => normalize(s.schoolCode) !== normalize(school.code)),
      created,
    ];

    try {
      await update({
        subscriptions: next,
        subscriptionAuditLog: appendSubscriptionAudit(state.subscriptionAuditLog, {
          action: "Attribution abonnement",
          schoolCode: school.code,
          subscriptionId: created.id,
          author: user?.identifier ?? user?.email,
          details: `${offer.name}${startTrial ? " (essai)" : ""}`,
        }),
      });
      setAssignSchool("");
      setAssignOfferId("");
      showToast("Abonnement attribué", "success");
    } catch {
      showToast("Échec de l'attribution", "error");
    } finally {
      setBusy(false);
    }
  }

  async function renew(subscription: Subscription) {
    setBusy(true);
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const endDate = nextYear.toLocaleDateString("fr-FR").replace(/\//g, "-");
    const next = state.subscriptions.map((item) => {
      if (normalize(String(item.schoolCode)) !== normalize(String(subscription.schoolCode))) {
        return item;
      }
      return {
        ...item,
        lifecycleStatus: "Actif" as const,
        status: "Actif",
        paymentStatus: "À jour",
        accessLevel: "full" as const,
        endDate,
        nextRenewalDate: endDate,
      };
    });
    try {
      await update({ subscriptions: next });
      showToast("Abonnement renouvelé", "success");
    } catch {
      showToast("Échec du renouvellement", "error");
    } finally {
      setBusy(false);
    }
  }

  async function suspend(subscription: Subscription) {
    setBusy(true);
    const next = state.subscriptions.map((item) => {
      if (normalize(String(item.schoolCode)) !== normalize(String(subscription.schoolCode))) {
        return item;
      }
      return {
        ...item,
        lifecycleStatus: "Suspendu" as const,
        status: "Suspendu",
        accessLevel: "blocked" as const,
        suspensionReason: "Suspension manuelle",
      };
    });
    try {
      await update({
        subscriptions: next,
        subscriptionAuditLog: appendSubscriptionAudit(state.subscriptionAuditLog, {
          action: "Suspension",
          schoolCode: subscription.schoolCode,
          author: user?.identifier ?? user?.email,
          details: "Suspension manuelle",
        }),
      });
      showToast("Abonnement suspendu", "success");
    } catch {
      showToast("Échec", "error");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Subscription>[] = [
    {
      key: "schoolCode",
      header: "Établissement",
      render: (s) => <span className="font-semibold">{s.schoolCode}</span>,
    },
    { key: "country", header: "Pays" },
    { key: "plan", header: "Offre" },
    {
      key: "lifecycle",
      header: "Statut",
      render: (s) => <StatusBadge status={resolveLifecycleStatus(s)} />,
    },
    {
      key: "access",
      header: "Accès",
      render: (s) => {
        const level = resolveAccessLevel(s);
        const tone = level === "full" ? "success" : level === "limited" ? "warning" : "danger";
        const label =
          level === "full" ? "Complet" : level === "limited" ? "Limité" : level === "readonly" ? "Lecture seule" : "Bloqué";
        return <Badge tone={tone}>{label}</Badge>;
      },
    },
    {
      key: "monthlyPrice",
      header: "Mensuel",
      align: "right",
      render: (s) => formatMetric(Number(s.monthlyPrice ?? 0), s.currency ?? "EUR"),
    },
    { key: "paymentStatus", header: "Paiement", render: (s) => <StatusBadge status={s.paymentStatus} /> },
    { key: "endDate", header: "Échéance" },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (s) =>
        canUpdate ? (
          <div className="flex justify-end gap-1">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void renew(s)}>
              Renouveler
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void suspend(s)}>
              Suspendre
            </Button>
          </div>
        ) : null,
    },
  ];

  const schoolOptions = schools.map((s: School) => ({ value: s.code, label: `${s.code} — ${s.name}` }));
  const offerOptions = assignableOffers
    .filter((o) => o.active)
    .map((o) => ({ value: o.id, label: `${o.name} (${formatMetric(o.monthlyPrice, o.currency)}/mois)` }));

  return (
    <div className="space-y-4">
      {canCreate ? (
        <Card className="p-6">
          <SectionHeader
            title="Attribuer une offre"
            description="Un établissement ne peut avoir qu'un seul abonnement principal actif à la fois."
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Établissement">
              <Select
                value={assignSchool}
                options={[{ value: "", label: "Choisir…" }, ...schoolOptions]}
                onChange={(e) => {
                  setAssignSchool(e.target.value);
                  setAssignOfferId("");
                }}
              />
            </Field>
            <Field label="Offre">
              <Select
                value={assignOfferId}
                options={[{ value: "", label: "Choisir…" }, ...offerOptions]}
                onChange={(e) => setAssignOfferId(e.target.value)}
              />
            </Field>
            <Field label="Mode">
              <Select
                value={startTrial ? "trial" : "direct"}
                options={[
                  { value: "direct", label: "Activation immédiate" },
                  { value: "trial", label: "Période d'essai" },
                ]}
                onChange={(e) => setStartTrial(e.target.value === "trial")}
              />
            </Field>
            <div className="flex items-end">
              <Button disabled={busy} onClick={() => void assignSubscription()}>
                Attribuer
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="p-6">
        <SectionHeader
          title="Abonnements établissements"
          description={`${rows.length} abonnement(s) dans votre périmètre.`}
          actions={<PrintButton documentTitle="Abonnements établissements — Somafrik" />}
        />
        <div className="mt-4">
          <Table columns={columns} rows={rows} rowKey={(s) => s.id ?? s.schoolCode} />
        </div>
      </Card>
    </div>
  );
}
