import { useMemo, useState, useRef, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { scopedCountries, scopedSchools } from "../lib/scope";
import { normalize } from "../lib/format";
import { canManageRolePermissions } from "../lib/permissions";
import { useFeaturePermissions, usePermissionContext } from "../lib/usePermissionContext";
import {
  COUNTRY_ADMIN_ROLE,
  isSchoolAwaitingSuperadminValidation,
  isSuperAdminRole,
  PENDING_VALIDATION_STATUS,
  SCHOOL_ADMIN_ROLE,
  VALIDATED_STATUS,
} from "../lib/orgHierarchy";
import {
  countSchoolStudents,
  filterActiveSchools,
  findPotentialDuplicates,
  findSchoolAdmin,
  formatSchoolDate,
  generateSchoolCode,
  schoolAuditHistory,
  SCHOOL_STATUSES,
  SCHOOL_TYPES,
  validateSchoolForm,
} from "../lib/schoolModule";
import { appendAuditLog, auditActor, makeAuditEntry } from "../lib/audit";
import { buildNewUserDraft } from "../lib/userAccounts";
import { establishmentsApi } from "../lib/establishmentsApi";
import { ensureSubscriptionOffers } from "../lib/subscriptionModule";
import { resolveSchoolSubscription } from "../lib/subscriptions";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PrintButton } from "../components/ui/PrintButton";
import { StatusBadge } from "../components/ui/Badge";
import { Table, type Column } from "../components/ui/Table";
import { Modal } from "../components/ui/Modal";
import { Field, Input, Select } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import type { BackOfficeState, School } from "../types";

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
  principalName: "",
  principalEmail: "",
  subscriptionPlan: "Standard",
};

export function SchoolsPage() {
  const { session } = useAuth();
  const { state, update, refresh } = useData();
  const ctx = usePermissionContext();
  const { showToast } = useToast();

  const allSchoolsRaw = scopedSchools(session?.user ?? null, state);
  const allSchools = useMemo(() => filterActiveSchools(allSchoolsRaw), [allSchoolsRaw]);
  const canValidateSchool = canManageRolePermissions(ctx);
  const isCountryAdminView = session?.user?.role === COUNTRY_ADMIN_ROLE;
  const isSuperAdmin = isSuperAdminRole(session?.user?.role);
  const { canCreate, canUpdate, canSuspend, canDelete } = useFeaturePermissions("Établissements");

  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [subscriptionPlan, setSubscriptionPlan] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<School | null>(null);
  const [editing, setEditing] = useState<School | null>(null);
  const [busy, setBusy] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<School[] | null>(null);
  const [pendingPayload, setPendingPayload] = useState<School | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const platformCountries = useMemo(
    () => scopedCountries(session?.user ?? null, state),
    [session?.user, state.countries],
  );

  const countryOptions = useMemo(
    () =>
      platformCountries.map((c) => ({
        value: c.name,
        label: `${c.name} (${c.code})`,
      })),
    [platformCountries],
  );

  const countries = useMemo(
    () => [...new Set(platformCountries.map((c) => c.name).filter(Boolean))] as string[],
    [platformCountries],
  );

  const subscriptionPlans = useMemo(() => {
    const fromOffers = ensureSubscriptionOffers(state.subscriptionOffers, state.countries).map((o) => o.name);
    const fromSchools = allSchools.map((s) => s.subscriptionPlan).filter(Boolean) as string[];
    return [...new Set([...fromOffers, ...fromSchools, "Essentiel", "Standard", "Premium"])];
  }, [state.subscriptionOffers, allSchools]);

  const types = useMemo(
    () => [...new Set([...SCHOOL_TYPES, ...allSchools.map((s) => s.type).filter(Boolean)])] as string[],
    [allSchools],
  );

  const cities = useMemo(
    () => [...new Set(allSchools.map((s) => s.city).filter(Boolean))] as string[],
    [allSchools],
  );

  const filtered = useMemo(() => {
    const q = normalize(search);
    return allSchools.filter((school) => {
      const subscriptionInfo = resolveSchoolSubscription(school, state);
      const matchesQuery =
        !q ||
        [school.name, school.code, school.city, school.email, school.principalName].some((v) =>
          normalize(v).includes(q),
        );
      const matchesCountry = !country || school.country === country;
      const matchesCity = !city || school.city === city;
      const matchesType = !type || school.type === type;
      const matchesStatus = !status || school.status === status;
      const matchesPlan =
        !subscriptionPlan ||
        school.subscriptionPlan === subscriptionPlan ||
        subscriptionInfo.plan === subscriptionPlan;
      return matchesQuery && matchesCountry && matchesCity && matchesType && matchesStatus && matchesPlan;
    });
  }, [allSchools, search, country, city, type, status, subscriptionPlan, state]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const isEditingExisting = Boolean(editing?.code && allSchools.some((s) => s.code === editing.code));

  function resetPage() {
    setPage(1);
  }

  function applyCountryToSchool(school: School, countryName: string): School {
    const selected = platformCountries.find((c) => c.name === countryName);
    const next: School = {
      ...school,
      country: selected?.name ?? countryName,
      countryCode: selected?.code ?? school.countryCode,
    };
    if (!isEditingExisting && selected?.code) {
      next.code = generateSchoolCode(selected.code, state.schools);
    }
    return next;
  }

  function auditSchool(action: string, school: School, details?: string) {
    return makeAuditEntry({
      ...auditActor(session?.user ?? null),
      action,
      entityType: "school",
      entityId: school.code,
      entityLabel: school.name,
      schoolCode: school.code,
      details,
    });
  }

  async function toggleSuspend(school: School) {
    setBusy(true);
    try {
      if (school.status === "Suspendu") {
        await establishmentsApi.activate(school.code);
        showToast("Établissement réactivé", "success");
      } else {
        await establishmentsApi.suspend(school.code);
        showToast("Établissement suspendu", "success");
      }
      await refresh();
      setDetail(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Échec de l'opération", "error");
    } finally {
      setBusy(false);
    }
  }

  async function softDeleteSchool(school: School) {
    setBusy(true);
    try {
      await establishmentsApi.remove(school.code);
      await refresh();
      showToast("Établissement supprimé (conservation des données)", "success");
      setDetail(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Échec de la suppression", "error");
    } finally {
      setBusy(false);
    }
  }

  async function validateSchool(school: School) {
    setBusy(true);
    try {
      await establishmentsApi.activate(school.code);
      await refresh();
      showToast("Établissement validé. Il peut désormais être pleinement exploité.", "success");
      setDetail(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Échec de la validation", "error");
    } finally {
      setBusy(false);
    }
  }

  async function rejectSchool(school: School) {
    setBusy(true);
    try {
      await establishmentsApi.update(school.code, { validationStatus: "Rejeté" });
      await refresh();
      showToast("Établissement rejeté", "success");
      setDetail(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Échec du rejet", "error");
    } finally {
      setBusy(false);
    }
  }

  async function createSchoolAdmin(school: School) {
    if (!session) return;
    const existing = findSchoolAdmin(state, school.code);
    if (existing) {
      showToast("Un administrateur existe déjà pour cet établissement", "error");
      return;
    }
    setBusy(true);
    try {
      const draft = buildNewUserDraft(SCHOOL_ADMIN_ROLE, session, state);
      draft.schoolCode = school.code;
      draft.countryScope = school.country ?? school.countryCode ?? "";
      draft.email = school.principalEmail ?? school.email ?? draft.email;
      draft.phone = school.principalPhone ?? school.phone ?? draft.phone;
      const parts = String(school.principalName ?? "").trim().split(/\s+/);
      draft.lastName = parts.pop() ?? "Admin";
      draft.firstName = parts.join(" ") || "École";
      await update({
        users: [draft, ...state.users],
        auditLog: appendAuditLog(
          state.auditLog,
          auditSchool("Création admin établissement", school, draft.identifier),
        ),
      });
      showToast(`Administrateur créé — identifiant : ${draft.identifier}`, "success");
    } catch {
      showToast("Échec de la création de l'administrateur", "error");
    } finally {
      setBusy(false);
    }
  }

  function openCreateFlow() {
    const pending = isCountryAdminView;
    const defaultCountry = platformCountries[0];
    const draft: School = {
      ...EMPTY_SCHOOL,
      country: defaultCountry?.name ?? session?.user?.countryScope ?? "",
      countryCode: defaultCountry?.code ?? "",
      status: pending ? "En attente" : "Actif",
      validationStatus: pending ? PENDING_VALIDATION_STATUS : VALIDATED_STATUS,
      validationRequestedBy: pending
        ? session?.user?.identifier ?? session?.user?.firstName ?? "Admin Pays"
        : undefined,
    };
    if (defaultCountry?.code) {
      draft.code = generateSchoolCode(defaultCountry.code, state.schools);
    }
    setEditing(draft);
  }

  async function saveSchool(payload: School, exists: boolean, force = false) {
    setBusy(true);
    try {
      if (exists) {
        await establishmentsApi.update(payload.code, payload);
      } else {
        await establishmentsApi.create(payload, force);
      }
      await refresh();
      showToast(
        !exists && isCountryAdminView
          ? "Établissement créé. En attente de validation par le Super Administrateur."
          : exists
            ? "Établissement mis à jour"
            : "Établissement créé",
        "success",
      );
      setEditing(null);
      setDuplicateCandidates(null);
      setPendingPayload(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Échec de la synchronisation";
      if (!exists && !force && message.toLowerCase().includes("doublon")) {
        const duplicates = findPotentialDuplicates(payload, state.schools);
        if (duplicates.length) {
          setDuplicateCandidates(duplicates);
          setPendingPayload(payload);
          return;
        }
      }
      showToast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportFile(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      const rows = parseEstablishmentCsv(text);
      if (!rows.length) {
        showToast("Fichier vide ou colonnes non reconnues", "error");
        return;
      }
      const result = await establishmentsApi.importRows(rows);
      await refresh();
      showToast(
        `${result.count} établissement(s) importé(s)${result.errors.length ? `, ${result.errors.length} erreur(s)` : ""}`,
        result.count ? "success" : "error",
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Échec de l'import", "error");
    } finally {
      setBusy(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;

    const exists = allSchools.some((s) => s.code === editing.code);
    const validationError = validateSchoolForm(editing, state.schools, { isNew: !exists });
    if (validationError) {
      showToast(validationError, "error");
      return;
    }

    const payload: School = {
      ...editing,
      code: editing.code.trim().toUpperCase(),
      name: editing.name.trim(),
      email: editing.email?.trim(),
      phone: editing.phone?.trim(),
      principalName: editing.principalName?.trim(),
      principalEmail: editing.principalEmail?.trim() || editing.email?.trim(),
      updatedAt: new Date().toISOString(),
    };

    if (!exists) {
      payload.createdAt = new Date().toISOString();
      if (isCountryAdminView) {
        payload.validationStatus = PENDING_VALIDATION_STATUS;
        payload.status = "En attente";
        payload.validationRequestedBy =
          session?.user?.identifier ?? session?.user?.firstName ?? "Admin Pays";
        payload.validationRequestedAt = payload.createdAt;
      }
    }

    if (!exists) {
      const duplicates = findPotentialDuplicates(payload, state.schools);
      if (duplicates.length) {
        setDuplicateCandidates(duplicates);
        setPendingPayload(payload);
        return;
      }
    }

    await saveSchool(payload, exists);
  }

  const columns: Column<School>[] = [
    {
      key: "code",
      header: "Code",
      render: (s) => <span className="font-mono text-xs font-semibold">{s.code}</span>,
    },
    {
      key: "name",
      header: "Nom",
      render: (s) => (
        <div>
          <p className="font-semibold text-ink">{s.name}</p>
          <p className="text-xs text-muted">{s.principalName ?? "—"}</p>
        </div>
      ),
    },
    { key: "type", header: "Type" },
    { key: "country", header: "Pays" },
    { key: "city", header: "Ville" },
    {
      key: "students",
      header: "Élèves",
      align: "right",
      render: (s) => countSchoolStudents(state, s.code),
    },
    {
      key: "subscription",
      header: "Abonnement",
      render: (s) => {
        const info = resolveSchoolSubscription(s, state);
        return info.plan || "—";
      },
    },
    {
      key: "createdAt",
      header: "Créé le",
      render: (s) => formatSchoolDate(s.createdAt),
    },
    { key: "validationStatus", header: "Validation", render: (s) => <StatusBadge status={s.validationStatus} /> },
    { key: "status", header: "Statut", render: (s) => <StatusBadge status={s.status} /> },
  ];

  return (
    <>
      <Card className="p-6">
        <SectionHeader
          title="Établissements"
          description={`${filtered.length} établissement(s) dans votre périmètre. Code auto : Pays-AAAA-0001.`}
          actions={
            <>
              <PrintButton documentTitle="Établissements — Somafrik" />
              {canCreate ? (
                <>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleImportFile(file);
                    }}
                  />
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => importInputRef.current?.click()}
                  >
                    Importer CSV
                  </Button>
                  <Button onClick={openCreateFlow}>Nouvel établissement</Button>
                </>
              ) : null}
            </>
          }
        />

        <div className="no-print mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Input
            placeholder="Rechercher nom, code, ville…"
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
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              resetPage();
            }}
            options={[{ value: "", label: "Toutes les villes" }, ...cities.map((c) => ({ value: c, label: c }))]}
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
              ...SCHOOL_STATUSES.filter((s) => s !== "Supprimé").map((s) => ({ value: s, label: s })),
            ]}
          />
          <Select
            value={subscriptionPlan}
            onChange={(e) => {
              setSubscriptionPlan(e.target.value);
              resetPage();
            }}
            options={[
              { value: "", label: "Tous les abonnements" },
              ...subscriptionPlans.map((p) => ({ value: p, label: p })),
            ]}
          />
        </div>

        <div className="mt-4">
          <Table
            columns={columns}
            rows={pageRows}
            rowKey={(s) => s.code}
            onRowClick={(school) => {
              const latest = allSchools.find((item) => item.code === school.code) ?? school;
              setDetail(latest);
            }}
          />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-muted">
            Page {safePage} / {totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
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
        size="lg"
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
                  <p className="text-sm text-muted">En attente de validation par le Super Administrateur.</p>
                );
              }
              return (
                <>
                  {canCreate && !findSchoolAdmin(state, detail.code) ? (
                    <Button variant="secondary" disabled={busy} onClick={() => void createSchoolAdmin(detail)}>
                      Créer admin établissement
                    </Button>
                  ) : null}
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
                  {canDelete && isSuperAdmin ? (
                    <Button variant="danger" disabled={busy} onClick={() => void softDeleteSchool(detail)}>
                      Supprimer
                    </Button>
                  ) : null}
                </>
              );
            })()
          ) : null
        }
      >
        {detail ? <SchoolDetailView school={detail} state={state} /> : null}
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={isEditingExisting ? "Modifier l'établissement" : "Nouvel établissement"}
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
            <Field label="Nom *">
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                required
                minLength={2}
              />
            </Field>
            <Field
              label="Code établissement *"
              hint={
                isEditingExisting && !isSuperAdmin
                  ? "Modifiable uniquement par le Super Administrateur."
                  : "Généré automatiquement à la sélection du pays."
              }
            >
              <Input
                value={editing.code}
                onChange={(e) => {
                  if (isSuperAdmin && isEditingExisting) {
                    setEditing({ ...editing, code: e.target.value.toUpperCase() });
                  }
                }}
                required
                readOnly={!isEditingExisting || !isSuperAdmin}
              />
            </Field>
            <Field label="Type *">
              <Select
                value={editing.type ?? ""}
                onChange={(e) => setEditing({ ...editing, type: e.target.value })}
                options={SCHOOL_TYPES.map((t) => ({ value: t, label: t }))}
                required
              />
            </Field>
            <Field
              label="Pays *"
              hint={
                !countryOptions.length
                  ? "Créez d'abord un pays dans Paramétrage plateforme → Pays."
                  : isEditingExisting && !isSuperAdmin
                    ? "Modifiable uniquement par le Super Administrateur."
                    : undefined
              }
            >
              {countryOptions.length ? (
                <Select
                  value={editing.country ?? ""}
                  onChange={(e) => setEditing(applyCountryToSchool(editing, e.target.value))}
                  disabled={isEditingExisting && !isSuperAdmin}
                  required
                  options={[{ value: "", label: "Choisir un pays…" }, ...countryOptions]}
                />
              ) : (
                <Input readOnly value="" placeholder="Aucun pays disponible" />
              )}
            </Field>
            <Field label="Ville *">
              <Input
                value={editing.city ?? ""}
                onChange={(e) => setEditing({ ...editing, city: e.target.value })}
                required
              />
            </Field>
            <Field label="Responsable principal *">
              <Input
                value={editing.principalName ?? ""}
                onChange={(e) => setEditing({ ...editing, principalName: e.target.value })}
                required
              />
            </Field>
            <Field label="Téléphone *">
              <Input
                value={editing.phone ?? ""}
                onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                required
              />
            </Field>
            <Field label="Email *">
              <Input
                type="email"
                value={editing.email ?? ""}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                required
              />
            </Field>
            <Field label="Email du responsable">
              <Input
                type="email"
                value={editing.principalEmail ?? ""}
                onChange={(e) => setEditing({ ...editing, principalEmail: e.target.value })}
              />
            </Field>
            <Field label="Adresse">
              <Input
                value={editing.address ?? ""}
                onChange={(e) => setEditing({ ...editing, address: e.target.value })}
              />
            </Field>
            <Field label="Logo (URL)" hint="URL publique du logo de l'établissement.">
              <Input
                type="url"
                value={editing.logoUrl ?? ""}
                onChange={(e) => setEditing({ ...editing, logoUrl: e.target.value })}
                placeholder="https://…"
              />
            </Field>
            <Field label="Offre d'abonnement">
              <Select
                value={editing.subscriptionPlan ?? "Standard"}
                onChange={(e) => setEditing({ ...editing, subscriptionPlan: e.target.value })}
                options={subscriptionPlans.map((p) => ({ value: p, label: p }))}
              />
            </Field>
            <Field label="Statut">
              <Select
                value={editing.status ?? "Actif"}
                onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                options={SCHOOL_STATUSES.filter((s) => s !== "Supprimé").map((s) => ({ value: s, label: s }))}
              />
            </Field>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(duplicateCandidates?.length && pendingPayload)}
        onClose={() => {
          setDuplicateCandidates(null);
          setPendingPayload(null);
        }}
        title="Doublon potentiel détecté"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDuplicateCandidates(null);
                setPendingPayload(null);
              }}
            >
              Corriger
            </Button>
            <Button
              disabled={busy}
              onClick={() => pendingPayload && void saveSchool(pendingPayload, false, true)}
            >
              Confirmer quand même
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Un ou plusieurs établissements similaires existent déjà (même nom/ville, email ou téléphone).
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          {duplicateCandidates?.map((school) => (
            <li key={school.code} className="rounded-lg border border-line px-3 py-2">
              <span className="font-semibold">{school.name}</span> — {school.code} · {school.city}
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

function SchoolDetailView({ school, state }: { school: School; state: BackOfficeState }) {
  const subscriptionInfo = resolveSchoolSubscription(school, state);
  const admin = findSchoolAdmin(state, school.code);
  const studentCount = countSchoolStudents(state, school.code);
  const history = schoolAuditHistory(state.auditLog, school.code).slice(0, 8);

  return (
    <div className="space-y-6">
      {isSchoolAwaitingSuperadminValidation(school) ? (
        <div className="rounded-xl border border-amber/30 bg-amber/10 p-4 text-sm text-ink">
          <p className="font-bold text-amber">En attente de validation</p>
          <p className="mt-1 text-muted">
            Créé par {school.validationRequestedBy ?? "Admin Pays"}. Validation Super Admin requise.
          </p>
        </div>
      ) : null}

      <DetailSection title="Informations générales">
        <DetailRow label="Code" value={school.code} />
        <DetailRow label="Type" value={school.type} />
        <DetailRow label="Pays" value={school.country} />
        <DetailRow label="Ville" value={school.city} />
        <DetailRow label="Statut" value={school.status} />
        <DetailRow label="Créé le" value={formatSchoolDate(school.createdAt)} />
      </DetailSection>

      <DetailSection title="Coordonnées">
        <DetailRow label="Téléphone" value={school.phone} />
        <DetailRow label="Email" value={school.email} />
        <DetailRow label="Adresse" value={school.address} />
        {school.logoUrl ? (
          <div className="col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Logo</dt>
            <dd className="mt-1">
              <img src={school.logoUrl} alt="" className="h-12 w-auto rounded border border-line" />
            </dd>
          </div>
        ) : null}
      </DetailSection>

      <DetailSection title="Responsable">
        <DetailRow label="Nom" value={school.principalName} />
        <DetailRow label="Email" value={school.principalEmail ?? school.email} />
        <DetailRow
          label="Admin établissement"
          value={admin ? `${admin.firstName} ${admin.lastName} (${admin.identifier})` : "Non créé"}
        />
        {!admin ? (
          <p className="col-span-2 text-xs text-muted">
            Créez l'administrateur depuis le bouton « Créer admin établissement » ou via{" "}
            <Link to="/administration/utilisateurs" className="font-semibold text-brand hover:underline">
              Administration → Utilisateurs
            </Link>
            .
          </p>
        ) : null}
      </DetailSection>

      <DetailSection title="Abonnement">
        <DetailRow label="Offre" value={subscriptionInfo.plan} />
        <DetailRow label="Statut paiement" value={subscriptionInfo.status} />
        <DetailRow label="Élèves actifs" value={String(studentCount)} />
      </DetailSection>

      {history.length ? (
        <DetailSection title="Historique">
          <ul className="col-span-2 space-y-2 text-sm">
            {history.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-line/70 px-3 py-2">
                <span className="font-semibold">{entry.action}</span>
                <span className="text-muted"> — {formatSchoolDate(entry.at)}</span>
                {entry.details ? <p className="text-xs text-muted">{entry.details}</p> : null}
              </li>
            ))}
          </ul>
        </DetailSection>
      ) : null}
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-black uppercase tracking-wide text-brand">{title}</h3>
      <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">{children}</dl>
    </div>
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

/** Parse un CSV ; séparateur ; ou , — colonnes : nom, type, pays, ville, telephone, email, responsable */
function parseEstablishmentCsv(text: string): Partial<School>[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(delimiter).map((h) => normalizeHeader(h));

  const mapRow = (values: string[]): Partial<School> | null => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = String(values[index] ?? "").trim();
    });
    const name = row.nom || row.name;
    if (!name) return null;
    return {
      name,
      type: row.type || "Collège",
      country: row.pays || row.country || "",
      city: row.ville || row.city || "",
      phone: row.telephone || row.phone || "",
      email: row.email || "",
      principalName: row.responsable || row.principal || row.principalname || "",
      subscriptionPlan: row.abonnement || row.plan || "Standard",
    };
  };

  return lines.slice(1).map((line) => line.split(delimiter)).map(mapRow).filter(Boolean) as Partial<School>[];
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
