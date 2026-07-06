import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { scopedCountries } from "../lib/scope";
import {
  canonicalCountryScope,
  countryScopeMatches,
  normalize,
  schoolMatchesCountryScope,
} from "../lib/format";
import { useFeaturePermissions } from "../lib/usePermissionContext";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PrintButton } from "../components/ui/PrintButton";
import { StatusBadge } from "../components/ui/Badge";
import { Table, type Column } from "../components/ui/Table";
import { Modal } from "../components/ui/Modal";
import { Field, Input, Select } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import type { BackOfficeState, Country } from "../types";
import {
  SUBSCRIPTION_PLAN_NAMES,
  resolveCountrySubscriptionPolicy,
} from "../lib/subscriptionPolicy";

const EMPTY_COUNTRY: Country = {
  name: "",
  code: "",
  phonePrefix: "",
  currency: "",
  timezone: "Africa/Kinshasa",
  status: "Actif",
};

function countryDependencies(state: BackOfficeState, country: Country) {
  const scope = canonicalCountryScope(country);
  const schools = state.schools.filter(
    (school) =>
      schoolMatchesCountryScope(school, scope) ||
      normalize(school.countryCode) === normalize(country.code),
  );
  const users = state.users.filter((user) => countryScopeMatches(user.countryScope, scope));
  const subscriptions = state.subscriptions.filter(
    (subscription) =>
      normalize(subscription.countryCode) === normalize(country.code) ||
      countryScopeMatches(subscription.country, scope),
  );
  return { schools: schools.length, users: users.length, subscriptions: subscriptions.length };
}

function validateCountry(
  country: Country,
  countries: Country[],
  originalCode?: string,
): string | null {
  if (!country.name?.trim()) {
    return "Le nom du pays est obligatoire.";
  }
  const code = String(country.code ?? "").trim().toUpperCase();
  if (!code) {
    return "Le code ISO du pays est obligatoire.";
  }
  if (!/^[A-Z]{2}$/.test(code)) {
    return "Le code pays doit comporter 2 lettres (ex. CD, BI, SN).";
  }
  const duplicate = countries.find(
    (item) => normalize(item.code) === normalize(code) && normalize(item.code) !== normalize(originalCode),
  );
  if (duplicate) {
    return `Le code « ${code} » est déjà utilisé par ${duplicate.name}.`;
  }
  return null;
}

export function CountriesPage() {
  const { session } = useAuth();
  const { state, update } = useData();
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Country | null>(null);
  const [editing, setEditing] = useState<Country | null>(null);
  const [originalCode, setOriginalCode] = useState("");

  const rows = scopedCountries(session?.user ?? null, state);
  const { canCreate, canUpdate, canDelete, canSuspend } = useFeaturePermissions("Pays");

  async function persistCountries(next: Country[], message: string) {
    setBusy(true);
    try {
      await update({ countries: next });
      showToast(message, "success");
    } catch {
      showToast("Échec de la synchronisation", "error");
      throw new Error("sync failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleSuspend(country: Country) {
    const nextStatus = country.status === "Suspendu" ? "Actif" : "Suspendu";
    const next = state.countries.map((item) =>
      item.code === country.code ? { ...item, status: nextStatus } : item,
    );
    try {
      await persistCountries(
        next,
        nextStatus === "Suspendu"
          ? `Pays suspendu : l'admin pays et les établissements de ${country.name} ne pourront plus se connecter.`
          : `Pays réactivé : ${country.name}.`,
      );
      setDetail(null);
    } catch {
      /* toast affiché */
    }
  }

  async function handleDelete(country: Country) {
    const deps = countryDependencies(state, country);
    if (deps.schools > 0 || deps.users > 0 || deps.subscriptions > 0) {
      showToast(
        `Suppression impossible : ${deps.schools} établissement(s), ${deps.users} compte(s) et ${deps.subscriptions} abonnement(s) rattachés. Retirez-les ou suspendez le pays.`,
        "error",
      );
      return;
    }
    const confirmed = await confirm({
      title: "Supprimer ce pays ?",
      description: `Supprimer définitivement le pays « ${country.name} » (${country.code}) ? Cette action est irréversible.`,
      confirmLabel: "Supprimer",
      tone: "danger",
    });
    if (!confirmed) return;

    const next = state.countries.filter((item) => item.code !== country.code);
    try {
      await persistCountries(next, `Pays supprimé : ${country.name}`);
      setDetail(null);
    } catch {
      /* toast affiché */
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;

    const payload: Country = {
      ...editing,
      name: editing.name.trim(),
      code: editing.code.trim().toUpperCase(),
      phonePrefix: editing.phonePrefix?.trim(),
      currency: editing.currency?.trim().toUpperCase(),
      timezone: editing.timezone?.trim(),
    };

    const error = validateCountry(payload, state.countries, originalCode || undefined);
    if (error) {
      showToast(error, "error");
      return;
    }

    const exists = state.countries.some((item) => normalize(item.code) === normalize(originalCode));
    const next = exists
      ? state.countries.map((item) =>
          normalize(item.code) === normalize(originalCode) ? { ...item, ...payload } : item,
        )
      : [
          {
            ...payload,
            id: payload.id ?? `COUNTRY-${payload.code}`,
            createdAt: payload.createdAt ?? new Date().toLocaleDateString("fr-FR"),
          },
          ...state.countries,
        ];

    try {
      await persistCountries(next, exists ? "Pays modifié" : "Pays créé");
      setEditing(null);
      setOriginalCode("");
    } catch {
      /* toast affiché */
    }
  }

  function openCreate() {
    setOriginalCode("");
    setEditing({ ...EMPTY_COUNTRY });
    setDetail(null);
  }

  function openEdit(country: Country) {
    setOriginalCode(country.code);
    setEditing({ ...country });
    setDetail(null);
  }

  const columns: Column<Country>[] = [
    { key: "name", header: "Pays", render: (country) => <span className="font-semibold">{country.name}</span> },
    { key: "code", header: "Code ISO" },
    { key: "phonePrefix", header: "Indicatif" },
    { key: "currency", header: "Devise" },
    { key: "status", header: "Statut", render: (country) => <StatusBadge status={country.status} /> },
  ];

  const isEditingExisting = Boolean(
    originalCode && state.countries.some((item) => normalize(item.code) === normalize(originalCode)),
  );

  return (
    <>
      <Card className="p-6">
        <SectionHeader
          title="Pays"
          description={`${rows.length} pays dans votre périmètre.`}
          actions={
            <>
              <PrintButton documentTitle="Pays — Somafrik" />
              {canCreate ? (
                <Button size="sm" onClick={openCreate}>
                  Nouveau pays
                </Button>
              ) : null}
            </>
          }
        />
        <div className="mt-4">
          <Table columns={columns} rows={rows} rowKey={(country) => country.code} onRowClick={setDetail} />
        </div>
      </Card>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.name ?? ""}
        description={`Code ISO : ${detail?.code ?? "—"}`}
        footer={
          detail ? (
            <>
              {canUpdate ? (
                <Button variant="secondary" onClick={() => openEdit(detail)}>
                  Modifier
                </Button>
              ) : null}
              {canDelete ? (
                <Button variant="danger" disabled={busy} onClick={() => void handleDelete(detail)}>
                  Supprimer
                </Button>
              ) : null}
              {canSuspend ? (
                <Button
                  variant={detail.status === "Suspendu" ? "primary" : "danger"}
                  disabled={busy}
                  onClick={() => void toggleSuspend(detail)}
                >
                  {detail.status === "Suspendu" ? "Réactiver" : "Suspendre"}
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        {detail ? (
          <>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <DetailRow label="Indicatif" value={detail.phonePrefix} />
              <DetailRow label="Devise" value={detail.currency} />
              <DetailRow label="Fuseau horaire" value={detail.timezone} />
              <DetailRow label="Statut" value={detail.status} />
              <DetailRow label="Créé le" value={detail.createdAt} />
            </dl>
            <div className="mt-5 border-t border-line pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Politique d'abonnement</p>
                <Link to="/parametres/abonnements" className="text-xs font-semibold text-brand hover:underline">
                  Modifier dans Paramètres →
                </Link>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {SUBSCRIPTION_PLAN_NAMES.map((plan) => {
                  const policy = resolveCountrySubscriptionPolicy(detail);
                  return (
                    <div key={plan} className="rounded-lg border border-line/70 p-3 text-sm">
                      <p className="font-semibold text-ink">{plan}</p>
                      <p className="mt-1 text-muted">
                        {policy.plans[plan].monthlyPrice} {policy.currency}/mois
                      </p>
                      <p className="text-xs text-muted">
                        {policy.plans[plan].annualPrice} {policy.currency}/an
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => {
          setEditing(null);
          setOriginalCode("");
        }}
        title={isEditingExisting ? "Modifier le pays" : "Nouveau pays"}
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(null);
                setOriginalCode("");
              }}
            >
              Annuler
            </Button>
            <Button form="country-form" type="submit" disabled={busy}>
              Enregistrer
            </Button>
          </>
        }
      >
        {editing ? (
          <form id="country-form" onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nom du pays">
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                required
              />
            </Field>
            <Field label="Code ISO" hint="2 lettres, ex. CD, BI, SN">
              <Input
                value={editing.code}
                onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })}
                maxLength={2}
                required
                readOnly={isEditingExisting}
              />
            </Field>
            <Field label="Indicatif téléphonique">
              <Input
                value={editing.phonePrefix ?? ""}
                onChange={(e) => setEditing({ ...editing, phonePrefix: e.target.value })}
                placeholder="+243"
              />
            </Field>
            <Field label="Devise">
              <Input
                value={editing.currency ?? ""}
                onChange={(e) => setEditing({ ...editing, currency: e.target.value.toUpperCase() })}
                placeholder="CDF"
              />
            </Field>
            <Field label="Fuseau horaire">
              <Input
                value={editing.timezone ?? ""}
                onChange={(e) => setEditing({ ...editing, timezone: e.target.value })}
                placeholder="Africa/Kinshasa"
              />
            </Field>
            <Field label="Statut">
              <Select
                value={editing.status ?? "Actif"}
                onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                options={["Actif", "Suspendu"].map((status) => ({ value: status, label: status }))}
              />
            </Field>
          </form>
        ) : null}
      </Modal>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{value || "—"}</dd>
    </div>
  );
}
