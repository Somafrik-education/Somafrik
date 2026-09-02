import { useEffect, useMemo, useState } from "react";
import { useData } from "../../context/DataContext";
import { useAuth } from "../../context/AuthContext";
import {
  DEFAULT_SUBSCRIPTION_OFFERS,
  SUBSCRIPTION_MODULE_LABELS,
  ensureSubscriptionOffers,
  filterOffersForCountry,
  formatOfferCountries,
} from "../../lib/subscriptionModule";
import { resolveCountrySubscriptionPolicy } from "../../lib/subscriptionPolicy";
import { scopedCountries } from "../../lib/scope";
import { COUNTRY_ADMIN_ROLE } from "../../lib/orgHierarchy";
import { useFeaturePermissions } from "../../lib/usePermissionContext";
import { formatMetric, normalize } from "../../lib/format";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Field";
import { Table, type Column } from "../../components/ui/Table";
import { Badge } from "../../components/ui/Badge";
import { useToast } from "../../components/ui/Toast";
import { platformApi } from "../../lib/platformApi";
import type { SubscriptionOffer } from "../../types";

export function SubscriptionOffersPage() {
  const { state, refresh } = useData();
  const { session } = useAuth();
  const { showToast } = useToast();
  const { canCreate, canUpdate } = useFeaturePermissions("Abonnements");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Partial<SubscriptionOffer> | null>(null);

  const countries = useMemo(
    () => scopedCountries(session?.user ?? null, state),
    [session?.user, state.countries],
  );

  const isCountryAdmin = session?.user?.role === COUNTRY_ADMIN_ROLE;
  const defaultCountryCode = useMemo(() => {
    if (isCountryAdmin && countries[0]?.code) return countries[0].code;
    return countries[0]?.code ?? "";
  }, [countries, isCountryAdmin]);

  const [countryFilter, setCountryFilter] = useState("");

  useEffect(() => {
    if (!countryFilter && defaultCountryCode) {
      setCountryFilter(defaultCountryCode);
    }
  }, [countryFilter, defaultCountryCode]);

  const allOffers = useMemo(
    () => ensureSubscriptionOffers(state.subscriptionOffers, state.countries),
    [state.subscriptionOffers, state.countries],
  );

  const offers = useMemo(
    () => filterOffersForCountry(allOffers, countryFilter || undefined),
    [allOffers, countryFilter],
  );

  const selectedCountry = countries.find((c) => normalize(c.code) === normalize(countryFilter));

  async function saveOffer() {
    if (!draft?.name?.trim()) {
      showToast("Le nom de l'offre est obligatoire", "error");
      return;
    }
    const countryCodes = (draft.countryCodes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean);
    if (!countryCodes.length) {
      showToast("Sélectionnez au moins un pays pour cette offre", "error");
      return;
    }

    setBusy(true);
    const isNew = !draft.id;
    const offer: SubscriptionOffer = {
      ...(DEFAULT_SUBSCRIPTION_OFFERS[1] as SubscriptionOffer),
      ...draft,
      id: draft.id ?? `OFFER-${Date.now()}`,
      name: draft.name.trim(),
      monthlyPrice: Number(draft.monthlyPrice ?? 0),
      annualPrice: Number(draft.annualPrice ?? 0),
      currency: String(draft.currency ?? "USD").toUpperCase(),
      countryCodes,
      active: draft.active !== false,
      modules: draft.modules ?? {},
      createdAt: draft.createdAt ?? new Date().toLocaleString("fr-FR"),
      updatedAt: new Date().toLocaleString("fr-FR"),
    };

    const nextOffers = isNew
      ? [...allOffers, offer]
      : allOffers.map((o) => (o.id === offer.id ? offer : o));

    const duplicate = nextOffers.some(
      (o) =>
        o.id !== offer.id &&
        normalizeName(o.name) === normalizeName(offer.name) &&
        (o.countryCodes ?? []).some((code) => countryCodes.includes(code.toUpperCase())),
    );
    if (duplicate) {
      showToast("Une offre avec ce nom existe déjà pour ce pays", "error");
      setBusy(false);
      return;
    }

    try {
      await platformApi.upsertSubscriptionOffer(offer as unknown as Record<string, unknown>);
      await refresh();
      setDraft(null);
      showToast(isNew ? "Offre créée" : "Offre mise à jour", "success");
    } catch {
      showToast("Échec de l'enregistrement", "error");
    } finally {
      setBusy(false);
    }
  }

  function openCreateDraft() {
    const code = countryFilter || defaultCountryCode;
    const country = countries.find((c) => normalize(c.code) === normalize(code));
    const policy = country ? resolveCountrySubscriptionPolicy(country) : null;
    setDraft({
      name: "",
      monthlyPrice: policy?.plans.Standard.monthlyPrice ?? 30,
      annualPrice: policy?.plans.Standard.annualPrice ?? 300,
      currency: policy?.currency ?? country?.currency ?? "USD",
      countryCodes: code ? [code.toUpperCase()] : [],
      active: true,
      modules: { students: true, classes: true, presences: true },
      maxStudents: 500,
    });
  }

  const columns: Column<SubscriptionOffer>[] = [
    {
      key: "name",
      header: "Offre",
      render: (o) => (
        <div>
          <p className="font-semibold text-ink">{o.name}</p>
          <p className="text-xs text-muted">{o.targetAudience ?? "—"}</p>
        </div>
      ),
    },
    {
      key: "country",
      header: "Pays",
      render: (o) => (
        <span className="text-xs text-muted">{formatOfferCountries(o, countries)}</span>
      ),
    },
    {
      key: "monthly",
      header: "Mensuel",
      align: "right",
      render: (o) => formatMetric(o.monthlyPrice, o.currency),
    },
    {
      key: "annual",
      header: "Annuel",
      align: "right",
      render: (o) => (o.annualPrice ? formatMetric(o.annualPrice, o.currency) : "—"),
    },
    {
      key: "limits",
      header: "Limites",
      render: (o) => (
        <span className="text-xs text-muted">
          {o.maxStudents == null ? "Élèves ∞" : `${o.maxStudents} él.`}
          {" · "}
          {o.trialDays ? `${o.trialDays} j essai` : "Sans essai"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Statut",
      render: (o) => (
        <Badge tone={o.active ? "success" : "neutral"}>{o.active ? "Actif" : "Inactif"}</Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (o) =>
        canUpdate ? (
          <Button variant="secondary" size="sm" onClick={() => setDraft({ ...o })}>
            Modifier
          </Button>
        ) : null,
    },
  ];

  const countryOptions = countries.map((c) => ({
    value: c.code,
    label: `${c.name} (${c.code})`,
  }));

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <SectionHeader
          title="Offres d'abonnement"
          description="Plans commerciaux Somafrik par pays. Chaque offre est rattachée à un ou plusieurs pays."
          actions={
            canCreate ? (
              <Button onClick={openCreateDraft} disabled={!countryFilter}>
                Nouvelle offre
              </Button>
            ) : null
          }
        />

        <div className="no-print mt-4 max-w-md">
          <Field label="Pays">
            <Select
              value={countryFilter}
              disabled={isCountryAdmin && countries.length <= 1}
              options={countryOptions}
              onChange={(e) => setCountryFilter(e.target.value)}
            />
          </Field>
          {selectedCountry ? (
            <p className="mt-2 text-xs text-muted">
              Devise du pays : {selectedCountry.currency ?? "—"} ·{" "}
              {offers.filter((o) => o.active).length} offre(s) active(s)
            </p>
          ) : null}
        </div>

        <div className="mt-4">
          <Table
            columns={columns}
            rows={offers}
            rowKey={(o) => o.id}
            emptyLabel={
              countryFilter
                ? "Aucune offre pour ce pays — créez-en une ou vérifiez les offres globales."
                : "Sélectionnez un pays"
            }
          />
        </div>
      </Card>

      {draft ? (
        <Card className="p-6">
          <SectionHeader title={draft.id ? "Modifier l'offre" : "Créer une offre"} />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Pays" required>
              <Select
                value={draft.countryCodes?.[0] ?? ""}
                options={countryOptions}
                onChange={(e) => {
                  const code = e.target.value.toUpperCase();
                  const country = countries.find((c) => normalize(c.code) === normalize(code));
                  const policy = country ? resolveCountrySubscriptionPolicy(country) : null;
                  setDraft({
                    ...draft,
                    countryCodes: code ? [code] : [],
                    currency: policy?.currency ?? country?.currency ?? draft.currency,
                  });
                }}
              />
            </Field>
            <Field label="Nom" required>
              <Input
                value={draft.name ?? ""}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="Cible">
              <Input
                value={draft.targetAudience ?? ""}
                onChange={(e) => setDraft({ ...draft, targetAudience: e.target.value })}
              />
            </Field>
            <Field label="Devise">
              <Input
                value={draft.currency ?? "USD"}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
              />
            </Field>
            <Field label="Prix mensuel" required>
              <Input
                type="number"
                min={0}
                value={draft.monthlyPrice ?? 0}
                onChange={(e) => setDraft({ ...draft, monthlyPrice: Number(e.target.value) })}
              />
            </Field>
            <Field label="Prix annuel">
              <Input
                type="number"
                min={0}
                value={draft.annualPrice ?? 0}
                onChange={(e) => setDraft({ ...draft, annualPrice: Number(e.target.value) })}
              />
            </Field>
            <Field label="Jours d'essai">
              <Input
                type="number"
                min={0}
                value={draft.trialDays ?? 0}
                onChange={(e) => setDraft({ ...draft, trialDays: Number(e.target.value) })}
              />
            </Field>
            <Field label="Max élèves">
              <Input
                type="number"
                min={0}
                placeholder="Illimité si vide"
                value={draft.maxStudents ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    maxStudents: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </Field>
            <Field label="Statut">
              <Select
                value={draft.active === false ? "inactive" : "active"}
                options={[
                  { value: "active", label: "Actif" },
                  { value: "inactive", label: "Inactif" },
                ]}
                onChange={(e) => setDraft({ ...draft, active: e.target.value === "active" })}
              />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void saveOffer()}>
              Enregistrer
            </Button>
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Annuler
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="p-6">
        <SectionHeader
          title={`Modules — ${selectedCountry?.name ?? "pays sélectionné"}`}
          description="Découpage Basic / Standard / Premium pour le pays affiché."
        />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase text-muted">
                <th className="py-2 pr-4">Module</th>
                {offers.slice(0, 4).map((o) => (
                  <th key={o.id} className="py-2 px-2 font-semibold">
                    {o.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(SUBSCRIPTION_MODULE_LABELS).map(([key, label]) => (
                <tr key={key} className="border-b border-line/60">
                  <td className="py-2 pr-4 font-medium">{label}</td>
                  {offers.slice(0, 4).map((o) => {
                    const mod = o.modules[key];
                    const text = mod === true ? "Oui" : mod === "limited" ? "Limité" : "Non";
                    return (
                      <td key={o.id} className="py-2 px-2 text-muted">
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}
