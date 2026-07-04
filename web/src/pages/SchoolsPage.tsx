import { useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { scopedSchools } from "../lib/scope";
import { normalize } from "../lib/format";
import {
  canManageRolePermissions,
} from "../lib/permissions";
import { useFeaturePermissions, usePermissionContext } from "../lib/usePermissionContext";
import {
  COUNTRY_ADMIN_ROLE,
  isSchoolAwaitingSuperadminValidation,
  PENDING_VALIDATION_STATUS,
  VALIDATED_STATUS,
} from "../lib/orgHierarchy";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PrintButton } from "../components/ui/PrintButton";
import { StatusBadge } from "../components/ui/Badge";
import { Table, type Column } from "../components/ui/Table";
import { Modal } from "../components/ui/Modal";
import { Field, Input, Select } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import type { School } from "../types";

const PAGE_SIZE = 10;
const EMPTY_SCHOOL: School = {
  code: "",
  name: "",
  type: "Collège",
  country: "",
  city: "",
  status: "Actif",
  validationStatus: VALIDATED_STATUS,
  phone: "",
  email: "",
  subscriptionPlan: "Standard",
};

export function SchoolsPage() {
  const { session } = useAuth();
  const { state, update } = useData();
  const ctx = usePermissionContext();
  const { showToast } = useToast();

  const allSchools = scopedSchools(session?.user ?? null, state);
  const canValidateSchool = canManageRolePermissions(ctx);
  const isCountryAdminView = session?.user?.role === COUNTRY_ADMIN_ROLE;
  const { canCreate, canUpdate, canSuspend } = useFeaturePermissions("Établissements");

  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<School | null>(null);
  const [editing, setEditing] = useState<School | null>(null);
  const [busy, setBusy] = useState(false);

  const countries = useMemo(
    () => [...new Set(allSchools.map((s) => s.country).filter(Boolean))] as string[],
    [allSchools],
  );
  const types = useMemo(
    () => [...new Set(allSchools.map((s) => s.type).filter(Boolean))] as string[],
    [allSchools],
  );

  const filtered = useMemo(() => {
    const q = normalize(search);
    return allSchools.filter((school) => {
      const matchesQuery =
        !q ||
        [school.name, school.code, school.city, school.email].some((v) => normalize(v).includes(q));
      const matchesCountry = !country || school.country === country;
      const matchesType = !type || school.type === type;
      const matchesStatus = !status || school.status === status;
      return matchesQuery && matchesCountry && matchesType && matchesStatus;
    });
  }, [allSchools, search, country, type, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function resetPage() {
    setPage(1);
  }

  async function persistSchools(nextSchools: School[], message = "Établissements synchronisés") {
    setBusy(true);
    try {
      await update({ schools: nextSchools });
      showToast(message, "success");
    } catch {
      showToast("Échec de la synchronisation", "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleSuspend(school: School) {
    const nextStatus = school.status === "Suspendu" ? "Actif" : "Suspendu";
    const next = state.schools.map((s) =>
      s.code === school.code ? { ...s, status: nextStatus } : s,
    );
    await persistSchools(next);
    setDetail(null);
  }

  async function validateSchool(school: School) {
    const next = state.schools.map((s) =>
      s.code === school.code
        ? {
            ...s,
            validationStatus: VALIDATED_STATUS,
            validatedBy: session?.user?.identifier ?? session?.user?.firstName ?? "Super Admin",
            validatedAt: new Date().toISOString(),
          }
        : s,
    );
    await persistSchools(next, "Établissement validé. Il peut désormais être pleinement exploité.");
    setDetail(null);
  }

  async function rejectSchool(school: School) {
    const next = state.schools.map((s) =>
      s.code === school.code ? { ...s, validationStatus: "Rejeté" } : s,
    );
    await persistSchools(next, "Établissement rejeté");
    setDetail(null);
  }

  function openCreateFlow() {
    const pending = isCountryAdminView;
    setEditing({
      ...EMPTY_SCHOOL,
      country: countries[0] ?? session?.user?.countryScope ?? "",
      validationStatus: pending ? PENDING_VALIDATION_STATUS : VALIDATED_STATUS,
      validationRequestedBy: pending
        ? session?.user?.identifier ?? session?.user?.firstName ?? "Admin Pays"
        : undefined,
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const exists = state.schools.some((s) => s.code === editing.code);
    const payload: School = {
      ...editing,
      code: editing.code.trim().toUpperCase(),
      name: editing.name.trim(),
    };

    if (!exists && isCountryAdminView) {
      payload.validationStatus = PENDING_VALIDATION_STATUS;
      payload.validationRequestedBy =
        session?.user?.identifier ?? session?.user?.firstName ?? "Admin Pays";
      payload.validationRequestedAt = new Date().toISOString();
    }

    const next = exists
      ? state.schools.map((s) => (s.code === editing.code ? { ...s, ...payload } : s))
      : [payload, ...state.schools];
    const message =
      !exists && isCountryAdminView
        ? "Établissement créé. En attente de validation par le Super Administrateur."
        : undefined;
    await persistSchools(next, message);
    setEditing(null);
  }

  const columns: Column<School>[] = [
    {
      key: "name",
      header: "Établissement",
      render: (s) => (
        <div>
          <p className="font-semibold text-ink">{s.name}</p>
          <p className="text-xs text-muted">{s.code}</p>
        </div>
      ),
    },
    { key: "type", header: "Type" },
    { key: "country", header: "Pays" },
    { key: "city", header: "Ville" },
    { key: "validationStatus", header: "Validation", render: (s) => <StatusBadge status={s.validationStatus} /> },
    { key: "status", header: "Statut", render: (s) => <StatusBadge status={s.status} /> },
  ];

  return (
    <>
      <Card className="p-6">
        <SectionHeader
          title="Établissements"
          description={`${filtered.length} établissement(s) dans votre périmètre.`}
          actions={
            <>
              <PrintButton documentTitle="Établissements — Somafrik" />
              {canCreate ? (
                <Button onClick={openCreateFlow}>
                  Nouvel établissement
                </Button>
              ) : null}
            </>
          }
        />

        <div className="no-print mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            placeholder="Rechercher…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
          />
          <Select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              resetPage();
            }}
            options={[{ value: "", label: "Tous les pays" }, ...countries.map((c) => ({ value: c, label: c }))]}
          />
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              resetPage();
            }}
            options={[{ value: "", label: "Tous les types" }, ...types.map((t) => ({ value: t, label: t }))]}
          />
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              resetPage();
            }}
            options={[
              { value: "", label: "Tous les statuts" },
              { value: "Actif", label: "Actif" },
              { value: "Suspendu", label: "Suspendu" },
            ]}
          />
        </div>

        <div className="mt-4">
          <Table columns={columns} rows={pageRows} rowKey={(s) => s.code} onRowClick={(school) => {
            const latest = state.schools.find((item) => item.code === school.code) ?? school;
            setDetail(latest);
          }} />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-muted">
            Page {safePage} / {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Précédent
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Suivant
            </Button>
          </div>
        </div>
      </Card>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.name ?? ""}
        description={detail?.code}
        footer={
          detail ? (
            (() => {
              const detailPending = isSchoolAwaitingSuperadminValidation(detail);
              if (detailPending) {
                return canValidateSchool ? (
                  <>
                    <Button variant="primary" disabled={busy} onClick={() => void validateSchool(detail)}>
                      Valider l'établissement
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => void rejectSchool(detail)}>
                      Rejeter
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted">
                    En attente de validation par le Super Administrateur.
                  </p>
                );
              }
              return (
                <>
                  {canUpdate ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditing(detail);
                        setDetail(null);
                      }}
                    >
                      Modifier
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
              );
            })()
          ) : null
        }
      >
        {detail ? (
          <>
            {isSchoolAwaitingSuperadminValidation(detail) ? (
              <div className="mb-4 rounded-xl border border-amber/30 bg-amber/10 p-4 text-sm text-ink">
                <p className="font-bold text-amber">En attente de validation</p>
                <p className="mt-1 text-muted">
                  Cet établissement a été créé par un Admin Pays
                  {detail.validationRequestedBy ? ` (${detail.validationRequestedBy})` : ""}. Seul le Super
                  Administrateur peut le valider avant exploitation complète.
                </p>
              </div>
            ) : null}
            <dl className="grid grid-cols-2 gap-4 text-sm">
            <DetailRow label="Type" value={detail.type} />
            <DetailRow label="Pays" value={detail.country} />
            <DetailRow label="Ville" value={detail.city} />
            <DetailRow label="Téléphone" value={detail.phone} />
            <DetailRow label="Email" value={detail.email} />
            <DetailRow label="Plan" value={detail.subscriptionPlan} />
            <DetailRow label="Abonnement" value={detail.subscriptionStatus} />
            <DetailRow label="Validation" value={detail.validationStatus} />
            <DetailRow label="Statut" value={detail.status} />
          </dl>
          </>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={state.schools.some((s) => s.code === editing?.code) ? "Modifier l'établissement" : "Nouvel établissement"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Annuler
            </Button>
            <Button form="school-form" type="submit" disabled={busy}>
              Enregistrer
            </Button>
          </>
        }
      >
        {editing ? (
          <form id="school-form" onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nom">
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
            </Field>
            <Field label="Code établissement">
              <Input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} required />
            </Field>
            <Field label="Type">
              <Select
                value={editing.type ?? ""}
                onChange={(e) => setEditing({ ...editing, type: e.target.value })}
                options={["École primaire", "Collège", "Lycée", "Université", "Institut"].map((t) => ({ value: t, label: t }))}
              />
            </Field>
            <Field label="Pays">
              <Input value={editing.country ?? ""} onChange={(e) => setEditing({ ...editing, country: e.target.value })} />
            </Field>
            <Field label="Ville">
              <Input value={editing.city ?? ""} onChange={(e) => setEditing({ ...editing, city: e.target.value })} />
            </Field>
            <Field label="Téléphone">
              <Input value={editing.phone ?? ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={editing.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
            </Field>
            <Field label="Plan d'abonnement">
              <Select
                value={editing.subscriptionPlan ?? "Standard"}
                onChange={(e) => setEditing({ ...editing, subscriptionPlan: e.target.value })}
                options={["Essentiel", "Standard", "Premium"].map((p) => ({ value: p, label: p }))}
              />
            </Field>
            <Field label="Statut">
              <Select
                value={editing.status ?? "Actif"}
                onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                options={["Actif", "Suspendu"].map((s) => ({ value: s, label: s }))}
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
