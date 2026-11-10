/**
 * BULLETIN-CATALOG-01 — « Catalogue des bulletins » (Superadmin).
 *
 * Le Superadmin gère la DISPONIBILITÉ des modèles par pays ; il ne modifie pas
 * les modèles (aucun éditeur), ne voit aucun élève, aucune note, aucun bulletin.
 * Chaque changement exige une confirmation explicite et est journalisé côté
 * serveur (modèle, pays, ancienne valeur, nouvelle valeur, auteur, date).
 * Retirer un modèle d'un pays bloque seulement les NOUVELLES configurations :
 * configurations actives, bulletins publiés et QR restent valides.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "../components/ui/Card";
import { Field, Input, Select } from "../components/ui/Field";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Modal } from "../components/ui/Modal";
import { ReportCardPresentationTable } from "../components/bulletin/ReportCardPresentationTable";
import {
  catalogErrorMessage,
  catalogUnavailability,
  isAccessDenied,
  modelTypeLabel,
  reportCardCatalogApi,
  type AdminCatalogModel,
  type AvailabilityAuditEntry,
  type CatalogCountry,
} from "../lib/reportCardCatalogApi";
import { ReportCardModelThumbnail } from "../components/bulletin/ReportCardModelThumbnail";

type AvailabilityFilter = "" | "AVAILABLE" | "UNAVAILABLE";
type PendingChange = { model: AdminCatalogModel; country: CatalogCountry; next: boolean };

function availableIn(model: AdminCatalogModel, countryId: string) {
  return model.availability.some((entry) => entry.country_id === countryId && entry.available);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

function valueLabel(value: boolean | null) {
  if (value === null) return "Jamais configuré";
  return value ? "Disponible" : "Non disponible";
}

export function ReportCardCatalogAdminPage() {
  const [countries, setCountries] = useState<CatalogCountry[]>([]);
  const [models, setModels] = useState<AdminCatalogModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [countryId, setCountryId] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AvailabilityFilter>("");
  const [viewing, setViewing] = useState<AdminCatalogModel | null>(null);
  const [managing, setManaging] = useState<AdminCatalogModel | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [saving, setSaving] = useState(false);
  const [changeError, setChangeError] = useState("");
  const [notice, setNotice] = useState("");
  const [audit, setAudit] = useState<AvailabilityAuditEntry[] | null>(null);
  const [auditError, setAuditError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await reportCardCatalogApi.adminOverview();
      setCountries(Array.isArray(data?.countries) ? data.countries : []);
      setModels(Array.isArray(data?.models) ? data.models : []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const countryName = useCallback(
    (id: string) => countries.find((country) => country.id === id)?.name ?? "Pays inconnu",
    [countries],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("fr");
    return models.filter((model) => {
      if (needle && !model.name.toLocaleLowerCase("fr").includes(needle)) return false;
      if (!filter) return true;
      const isAvailable = countryId ? availableIn(model, countryId) : model.availability.some((entry) => entry.available);
      return filter === "AVAILABLE" ? isAvailable : !isAvailable;
    });
  }, [models, search, filter, countryId]);

  async function openManage(model: AdminCatalogModel) {
    setManaging(model);
    setChangeError("");
    setNotice("");
    setAudit(null);
    setAuditError("");
    try {
      const data = await reportCardCatalogApi.adminAudit(model.model_id);
      setAudit(Array.isArray(data?.audit) ? data.audit : []);
    } catch (err) {
      setAuditError(catalogErrorMessage(err));
    }
  }

  async function applyChange() {
    if (!pending) return;
    setSaving(true);
    setChangeError("");
    try {
      await reportCardCatalogApi.setAvailability(pending.model.model_id, pending.country.id, pending.next);
      setNotice(
        `${pending.model.name} est maintenant ${pending.next ? "disponible" : "non disponible"} pour ${pending.country.name}.`,
      );
      const modelId = pending.model.model_id;
      setPending(null);
      const data = await reportCardCatalogApi.adminOverview();
      const nextModels = Array.isArray(data?.models) ? data.models : [];
      setModels(nextModels);
      const refreshed = nextModels.find((model) => model.model_id === modelId) ?? null;
      setManaging(refreshed);
      const history = await reportCardCatalogApi.adminAudit(modelId).catch(() => null);
      if (history) setAudit(Array.isArray(history.audit) ? history.audit : []);
    } catch (err) {
      setChangeError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const header = (
    <div className="flex flex-col gap-1">
      <h2 className="text-xl font-bold text-ink">Catalogue des bulletins</h2>
      <p className="max-w-3xl text-sm text-muted">
        Choisissez dans quels pays chaque modèle peut être configuré par les établissements. Retirer un modèle
        d'un pays n'affecte ni les configurations déjà actives ni les bulletins publiés.
      </p>
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {header}
        <Card className="p-6" >
          <p role="status" className="text-sm text-muted" data-testid="catalog-admin-loading">Chargement du catalogue…</p>
        </Card>
      </div>
    );
  }

  const unavailable = error ? catalogUnavailability(error) : null;
  if (unavailable) {
    return (
      <div className="space-y-6">
        {header}
        <Card className="p-6">
          <div data-testid={unavailable === "NOT_INSTALLED" ? "catalog-admin-not-installed" : "catalog-admin-outdated"} role="status">
            <p className="text-sm font-bold text-ink">
              {unavailable === "NOT_INSTALLED"
                ? "Le catalogue des bulletins n'est pas encore installé sur ce serveur."
                : "Ce serveur ne propose pas encore le catalogue des bulletins."}
            </p>
            <p className="mt-1 text-sm text-muted">
              {unavailable === "NOT_INSTALLED"
                ? "L'installation (migration de la base de données) doit être réalisée par l'équipe technique, après autorisation. Aucune donnée existante n'est concernée : les bulletins publiés restent consultables."
                : "La version de l'API déployée est antérieure au catalogue. Le déploiement doit être mis à jour par l'équipe technique."}
            </p>
            <p className="mt-2 text-xs text-muted">
              Référence pour le support : {unavailable === "NOT_INSTALLED" ? "CATALOG_UNAVAILABLE (HTTP 503)" : "route absente (HTTP 404)"}
            </p>
            <Button className="mt-3" variant="secondary" size="sm" onClick={() => void load()}>
              Vérifier à nouveau
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    const denied = isAccessDenied(error);
    return (
      <div className="space-y-6">
        {header}
        <Card className="p-6">
          <div data-testid={denied ? "catalog-admin-denied" : "catalog-admin-error"}>
            <p role="alert" className="text-sm font-bold text-red-800">
              {denied ? "Accès refusé : cette page est réservée au Superadmin Somafrik." : catalogErrorMessage(error)}
            </p>
            {!denied ? (
              <Button className="mt-3" variant="secondary" size="sm" onClick={() => void load()}>
                Réessayer
              </Button>
            ) : null}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="catalog-admin">
      {header}

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
          <Field label="Pays" htmlFor="catalog-country">
            <Select
              id="catalog-country"
              value={countryId}
              onChange={(event) => setCountryId(event.target.value)}
              options={[{ value: "", label: "Tous les pays" }, ...countries.map((country) => ({ value: country.id, label: country.name }))]}
            />
          </Field>
          <Field label="Rechercher un modèle" htmlFor="catalog-search">
            <Input
              id="catalog-search"
              type="search"
              placeholder="Nom du modèle"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
          <Field label="Disponibilité" htmlFor="catalog-filter">
            <Select
              id="catalog-filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value as AvailabilityFilter)}
              options={[
                { value: "", label: "Tous les modèles" },
                { value: "AVAILABLE", label: countryId ? "Disponibles dans ce pays" : "Disponibles dans au moins un pays" },
                { value: "UNAVAILABLE", label: countryId ? "Non disponibles dans ce pays" : "Disponibles nulle part" },
              ]}
            />
          </Field>
        </div>
      </Card>

      {models.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-muted" data-testid="catalog-admin-empty">Aucun modèle n'est encore enregistré dans le catalogue.</p>
        </Card>
      ) : visible.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-muted" data-testid="catalog-admin-no-match">Aucun modèle ne correspond à ces critères.</p>
          <Button className="mt-3" variant="secondary" size="sm" onClick={() => { setSearch(""); setFilter(""); }}>
            Effacer les filtres
          </Button>
        </Card>
      ) : (
        <ul className="grid gap-5 lg:grid-cols-2" aria-label="Modèles du catalogue">
          {visible.map((model) => {
            const allowed = model.availability.filter((entry) => entry.available).map((entry) => countryName(entry.country_id));
            return (
              <li key={model.model_id}>
                <Card className="flex h-full flex-col overflow-hidden">
                  <article data-testid={`catalog-admin-model-${model.model_id}`} className="flex h-full flex-col">
                    <ReportCardModelThumbnail view={model.preview} label={`Aperçu du ${model.name}`} />
                    <div className="flex flex-1 flex-col gap-3 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h2 className="text-lg font-bold text-ink">{model.name}</h2>
                        <Badge tone={model.status === "active" ? "success" : "neutral"}>
                          {model.status === "active" ? "Actif" : "Retiré"}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <Badge tone="info">{modelTypeLabel(model.presentation_style)}</Badge>
                        <Badge>Version {model.version}</Badge>
                      </div>
                      {model.description ? <p className="text-sm text-muted">{model.description}</p> : null}
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Pays autorisés</p>
                        {allowed.length ? (
                          <ul className="mt-1 flex flex-wrap gap-1.5" data-testid="catalog-admin-allowed">
                            {allowed.map((name) => (
                              <li key={name}><Badge tone="success">{name}</Badge></li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-sm text-muted" data-testid="catalog-admin-allowed-none">
                            Disponible dans aucun pays
                          </p>
                        )}
                      </div>
                      <div className="mt-auto flex flex-wrap gap-2 pt-2">
                        <Button variant="secondary" onClick={() => setViewing(model)} disabled={!model.preview}>
                          Voir le modèle
                        </Button>
                        <Button onClick={() => void openManage(model)} data-testid={`catalog-admin-manage-${model.model_id}`}>
                          Gérer la disponibilité
                        </Button>
                      </div>
                    </div>
                  </article>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={Boolean(viewing)}
        size="lg"
        title={viewing?.name ?? ""}
        description="Bulletin d'exemple calculé avec des données fictives — document non officiel."
        onClose={() => setViewing(null)}
        footer={<Button variant="secondary" onClick={() => setViewing(null)}>Fermer</Button>}
      >
        {viewing?.preview ? (
          <div className="max-h-[65vh] overflow-auto" data-testid="catalog-admin-view">
            <ReportCardPresentationTable view={viewing.preview} />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(managing) && !pending}
        size="lg"
        title={managing ? `Disponibilité — ${managing.name}` : ""}
        description="Les établissements d'un pays autorisé peuvent choisir et configurer ce modèle."
        onClose={() => setManaging(null)}
        footer={<Button variant="secondary" onClick={() => setManaging(null)}>Fermer</Button>}
      >
        {managing ? (
          <div className="space-y-5" data-testid="catalog-admin-availability">
            {notice ? <p role="status" className="rounded-lg bg-teal/10 px-3 py-2 text-sm font-semibold text-teal">{notice}</p> : null}
            {countries.length === 0 ? (
              <p className="text-sm text-muted">Aucun pays n'est enregistré sur la plateforme.</p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {countries.map((country) => {
                  const isOn = availableIn(managing, country.id);
                  const retired = managing.status !== "active";
                  return (
                    <li key={country.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div>
                        <p className="font-semibold text-ink">{country.name}</p>
                        <p className="text-xs text-muted">{isOn ? "Disponible" : "Non disponible"}</p>
                      </div>
                      <Button
                        size="sm"
                        variant={isOn ? "secondary" : "primary"}
                        disabled={!isOn && retired}
                        data-testid={`catalog-admin-toggle-${country.iso_code ?? country.id}`}
                        onClick={() => { setChangeError(""); setPending({ model: managing, country, next: !isOn }); }}
                      >
                        {isOn ? "Retirer de ce pays" : "Rendre disponible"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <section aria-labelledby="catalog-audit-title">
              <h3 id="catalog-audit-title" className="text-sm font-bold text-ink">Historique des changements</h3>
              {auditError ? (
                <p role="alert" className="mt-2 text-sm text-red-800">{auditError}</p>
              ) : audit === null ? (
                <p className="mt-2 text-sm text-muted">Chargement de l'historique…</p>
              ) : audit.length === 0 ? (
                <p className="mt-2 text-sm text-muted">Aucun changement enregistré.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-sm" data-testid="catalog-admin-audit">
                    <thead className="text-xs uppercase text-muted">
                      <tr>
                        <th className="py-1 pr-3">Date</th>
                        <th className="py-1 pr-3">Pays</th>
                        <th className="py-1 pr-3">Avant</th>
                        <th className="py-1 pr-3">Après</th>
                        <th className="py-1">Auteur</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {audit.map((row) => (
                        <tr key={String(row.id)}>
                          <td className="py-1.5 pr-3 whitespace-nowrap">{formatDate(row.created_at)}</td>
                          <td className="py-1.5 pr-3">{row.country_name || countryName(row.country_id)}</td>
                          <td className="py-1.5 pr-3">{valueLabel(row.old_available)}</td>
                          <td className="py-1.5 pr-3">{valueLabel(row.new_available)}</td>
                          <td className="py-1.5">{row.actor_label || "Superadmin"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(pending)}
        title={pending?.next ? "Rendre ce modèle disponible ?" : "Retirer ce modèle du pays ?"}
        onClose={() => (saving ? undefined : setPending(null))}
        footer={
          <>
            <Button variant="secondary" disabled={saving} onClick={() => setPending(null)}>Annuler</Button>
            <Button
              variant={pending?.next ? "primary" : "danger"}
              disabled={saving}
              data-testid="catalog-admin-confirm"
              onClick={() => void applyChange()}
            >
              {saving ? "Enregistrement…" : pending?.next ? "Confirmer la disponibilité" : "Confirmer le retrait"}
            </Button>
          </>
        }
      >
        {pending ? (
          <div className="space-y-3 text-sm" data-testid="catalog-admin-confirm-summary">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">Modèle</dt>
              <dd className="font-semibold text-ink">{pending.model.name}</dd>
              <dt className="text-muted">Pays</dt>
              <dd className="font-semibold text-ink">{pending.country.name}</dd>
              <dt className="text-muted">Changement</dt>
              <dd className="font-semibold text-ink">
                {pending.next ? "Non disponible → Disponible" : "Disponible → Non disponible"}
              </dd>
            </dl>
            <p className="text-muted">
              {pending.next
                ? "Les établissements de ce pays pourront choisir et configurer ce modèle."
                : "Les établissements de ce pays ne pourront plus configurer ce modèle. Les configurations déjà actives, les bulletins publiés et leurs QR codes restent valides."}
            </p>
            <p className="text-xs text-muted">Ce changement est enregistré dans l'historique (auteur et date).</p>
            {changeError ? <p role="alert" className="font-semibold text-red-800">{changeError}</p> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export default ReportCardCatalogAdminPage;
