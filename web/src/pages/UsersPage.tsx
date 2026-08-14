import { useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { useData } from "../context/DataContext";
import { scopedCountries, scopedSchools, scopedUsers } from "../lib/scope";
import { getCurrentSchool } from "../lib/establishment";
import { isInternalSchoolRole, normalize, getInitials, resolveCountryScopeFromSchool } from "../lib/format";
import { canManageRolePermissions, canResetTargetUserPassword } from "../lib/permissions";
import { USER_ACCOUNT_STATUS_OPTIONS, validatePasswordPolicy } from "../lib/userAccountRules";
import { useFeaturePermissions, usePermissionContext } from "../lib/usePermissionContext";
import {
  applyRoleChangeToUser,
  buildNewUserDraft,
  canManageUserAccount,
  canSuperadminManageUser,
  formatAccessChannelLabel,
  getCountryScopeOptions,
  getCreatableUserRoles,
  getUserEstablishmentLabel,
  getUserFormFieldPolicy,
  isCountryAdminProvisionedUser,
  validateUserAccount,
  resetUserAccountPassword,
} from "../lib/userAccounts";
import { applyUserTeacherSync, syncSingleUserToTeachers } from "../lib/userTeacherSync";
import { clientsApi } from "../lib/clientsApi";
import {
  COUNTRY_ADMIN_ROLE,
  isPendingValidationStatus,
  isSuperAdminRole,
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
import { usePrompt } from "../components/ui/PromptDialog";
import type { School, UserAccount } from "../types";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `usr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toCsv(users: UserAccount[], schools: School[]): string {
  const headers = ["Prénom", "Nom", "Rôle", "Identifiant", "Email", "Téléphone", "Établissement", "Pays", "Statut"];
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = users.map((u) =>
    [u.firstName, u.lastName, u.role, u.identifier, u.email, u.phone, getUserEstablishmentLabel(u, schools), u.countryScope, u.status]
      .map(escape)
      .join(","),
  );
  return [headers.map(escape).join(","), ...lines].join("\r\n");
}

export function UsersPage() {
  const { session } = useAuth();
  const { scopedUser, activeSchoolCode } = useActiveSchool();
  const { state, update, refresh } = useData();
  const ctx = usePermissionContext();
  const scopeUser = scopedUser ?? session?.user ?? null;
  const { showToast } = useToast();
  const { prompt } = usePrompt();

  const allUsers = scopedUsers(scopeUser, state);
  const schoolsForLabels = useMemo(
    () => scopedSchools(scopeUser, state),
    [scopeUser, state],
  );
  const isSuperadminView = isSuperAdminRole(session?.user?.role);
  const canValidateAccount = canManageRolePermissions(ctx);
  const isCountryAdminView = session?.user?.role === COUNTRY_ADMIN_ROLE;
  const school = getCurrentSchool(scopeUser, state);
  const schoolCode = activeSchoolCode || scopeUser?.schoolCode;
  const { canCreate, canUpdate, canSuspend } = useFeaturePermissions("Utilisateurs");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [detail, setDetail] = useState<UserAccount | null>(null);
  const [editing, setEditing] = useState<UserAccount | null>(null);
  const [busy, setBusy] = useState(false);

  const creatableRoles = useMemo(
    () => getCreatableUserRoles(scopeUser, state, schoolCode),
    [scopeUser, state, schoolCode],
  );

  const roleOptions = useMemo(
    () => [...new Set([...creatableRoles, ...allUsers.map((u) => u.role).filter(Boolean)])],
    [allUsers, creatableRoles],
  );

  const countryOptions = useMemo(
    () => getCountryScopeOptions(scopedCountries(scopeUser, state)),
    [scopeUser, state],
  );

  const schoolOptions = useMemo(() => {
    return scopedSchools(scopeUser, state).map((item) => ({
      value: item.code,
      label: `${item.name} (${item.code})`,
    }));
  }, [scopeUser, state]);

  const fieldPolicy = getUserFormFieldPolicy(scopeUser, editing?.role ?? creatableRoles[0] ?? "");
  const allowedSchoolCodes = useMemo(
    () => schoolOptions.map((option) => normalize(option.value)),
    [schoolOptions],
  );

  const filtered = useMemo(() => {
    const q = normalize(search);
    return allUsers.filter((u) => {
      const matchesQuery =
        !q ||
        [u.firstName, u.lastName, u.identifier, u.role, u.schoolCode, u.email].some((v) =>
          normalize(v).includes(q),
        );
      const matchesRole = !roleFilter || u.role === roleFilter;
      const matchesStatus = !statusFilter || String(u.status ?? "Actif") === statusFilter;
      const matchesPending =
        !pendingOnly || isPendingValidationStatus(u.validationStatus ?? u.status);
      return matchesQuery && matchesRole && matchesStatus && matchesPending;
    });
  }, [allUsers, search, roleFilter, statusFilter, pendingOnly]);

  async function persistUsers(next: UserAccount[], message: string, syncedUser?: UserAccount) {
    setBusy(true);
    try {
      if (syncedUser) {
        const exists = Boolean(syncedUser.id) && state.users.some((u) => u.id === syncedUser.id);
        if (exists) {
          await clientsApi.updateUser(String(syncedUser.id), syncedUser as unknown as Record<string, unknown>);
        } else {
          const created = (await clientsApi.createUser(
            syncedUser as unknown as Record<string, unknown>,
          )) as UserAccount;
          if (created.temporaryPassword) {
            showToast(`Mot de passe temporaire : ${created.temporaryPassword}`, "success");
          }
        }
        await refresh();
        showToast(message, "success");
        return;
      }
      const baseState = { ...state, users: next };
      const teacherPatch = applyUserTeacherSync(baseState);
      await refresh();
      showToast(message, "success");
    } catch {
      showToast("Échec de la synchronisation", "error");
      throw new Error("sync failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleSuspend(user: UserAccount) {
    const nextStatus = user.status === "Suspendu" ? "Actif" : "Suspendu";
    const next = state.users.map((u) => (u.id === user.id ? { ...u, status: nextStatus } : u));
    try {
      await persistUsers(next, `Compte ${nextStatus.toLowerCase()}`);
      setDetail(null);
    } catch {
      /* toast déjà affiché */
    }
  }

  async function rejectAccount(user: UserAccount) {
    if (!isSuperadminView || !canSuperadminManageUser(user)) return;
    const next = state.users.filter((u) => u.id !== user.id);
    try {
      await persistUsers(next, "Compte refusé et retiré");
      setDetail(null);
    } catch {
      /* toast déjà affiché */
    }
  }

  async function validateAccount(user: UserAccount) {
    const next = state.users.map((u) =>
      u.id === user.id
        ? {
            ...u,
            status: "Actif",
            validationStatus: VALIDATED_STATUS,
            validatedBy: session?.user?.identifier ?? session?.user?.firstName ?? "Super Admin",
            validatedAt: new Date().toISOString(),
          }
        : u,
    );
    try {
      await persistUsers(next, "Compte validé. L'Admin École peut désormais se connecter.");
      setDetail(null);
    } catch {
      /* toast déjà affiché */
    }
  }

  async function resetPassword(user: UserAccount) {
    const temporaryPassword = await prompt({
      title: "Mot de passe temporaire",
      description: `Définir un mot de passe temporaire pour ${user.firstName ?? user.identifier}.`,
      defaultValue: "Soma1234",
      placeholder: "Mot de passe (min. 6 caractères)",
      inputType: "password",
      confirmLabel: "Réinitialiser",
      validate: (value) => validatePasswordPolicy(value),
    });
    if (!temporaryPassword) return;
    setBusy(true);
    try {
      const issued = await resetUserAccountPassword(user, temporaryPassword);
      showToast(`Mot de passe réinitialisé · provisoire : ${issued}`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Échec de la réinitialisation", "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!editing || !session) return;

    const error = validateUserAccount(editing, state.users, creatableRoles, {
      creator: session.user,
      allowedSchoolCodes,
      teachers: state.teachers,
    });
    if (error) {
      showToast(error, "error");
      return;
    }

    const exists = Boolean(editing.id) && state.users.some((u) => u.id === editing.id);
    const payload: UserAccount = {
      ...editing,
      firstName: editing.firstName?.trim(),
      lastName: editing.lastName?.trim(),
      identifier: editing.identifier?.trim(),
    };

    const next = exists
      ? state.users.map((u) => (u.id === editing.id ? { ...u, ...payload } : u))
      : [
          {
            ...payload,
            id: payload.id ?? newId(),
            createdAt: new Date().toISOString(),
            history: [
              `Compte créé avec identifiant ${payload.identifier} et mot de passe temporaire ${payload.temporaryPassword ?? "—"}`,
            ],
          },
          ...state.users,
        ];

    try {
      const savedUser = exists
        ? (next.find((u) => u.id === editing.id) ?? payload)
        : (next[0] ?? payload);
      await persistUsers(next, exists ? "Utilisateur modifié" : "Utilisateur créé", savedUser);
      if (!exists && payload.temporaryPassword) {
        showToast(`Mot de passe temporaire : ${payload.temporaryPassword}`, "success");
      }
      setEditing(null);
    } catch {
      /* toast déjà affiché */
    }
  }

  function openCreateFlow() {
    if (!session) return;
    const defaultRole = creatableRoles[0] ?? "";
    if (!defaultRole) {
      showToast("Configurez d'abord les rôles dans Configuration → Rôles.", "error");
      return;
    }
    setEditing(buildNewUserDraft(defaultRole, session, state));
    setDetail(null);
  }

  function closeEditor() {
    setEditing(null);
  }

  function exportCsv() {
    const blob = new Blob(["\uFEFF" + toCsv(filtered, schoolsForLabels)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `utilisateurs-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Export CSV généré", "success");
  }

  const columns: Column<UserAccount>[] = [
    {
      key: "name",
      header: "Utilisateur",
      render: (u) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand">
            {getInitials(u.firstName, u.lastName)}
          </div>
          <div>
            <p className="font-semibold text-ink">
              {u.firstName} {u.lastName}
            </p>
            <p className="text-xs text-muted">{u.identifier}</p>
          </div>
        </div>
      ),
    },
    { key: "role", header: "Rôle" },
    { key: "schoolCode", header: "Établissement", render: (u) => getUserEstablishmentLabel(u, schoolsForLabels) },
    { key: "status", header: "Statut", render: (u) => <StatusBadge status={u.status} /> },
    ...(isSuperadminView
      ? [
          {
            key: "createdBy",
            header: "Créé par",
            render: (u: UserAccount) => (
              <span className="text-xs text-muted">
                {u.validationRequestedBy ?? u.createdBy ?? "—"}
              </span>
            ),
          } as Column<UserAccount>,
        ]
      : []),
  ];

  const isEditingExisting = Boolean(editing?.id && state.users.some((u) => u.id === editing.id));

  return (
    <>
      {isInternalSchoolRole(session?.user?.role) && school ? (
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-brand">Périmètre établissement</p>
          <p className="mt-1 text-lg font-black text-ink">{school.name}</p>
          <p className="text-sm text-muted">
            {school.code} • {school.city ?? "Ville non renseignée"} • {allUsers.length} compte(s) visible(s)
          </p>
        </Card>
      ) : null}

      <Card className="p-6">
        <SectionHeader
          title="Utilisateurs"
          description={
            isSuperadminView
              ? `${filtered.length} compte(s) plateforme. Le Super Admin valide et gère les Admin École créés par les Admin Pays.`
              : isCountryAdminView
                ? `${filtered.length} admin(s) école dans votre pays. Les comptes métier (secrétaire, enseignant…) se gèrent dans Configuration établissement.`
                : `${filtered.length} compte(s) accessibles.`
          }
          actions={
            <div className="flex gap-2">
              <PrintButton documentTitle="Utilisateurs — Somafrik" />
              <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!filtered.length}>
                Exporter CSV
              </Button>
              {canCreate ? (
                <Button size="sm" onClick={openCreateFlow}>
                  Nouvel utilisateur
                </Button>
              ) : null}
            </div>
          }
        />
        <div className="no-print mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            placeholder="Rechercher un utilisateur…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            options={[{ value: "", label: "Tous les rôles" }, ...roleOptions.map((r) => ({ value: r, label: r }))]}
          />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[{ value: "", label: "Tous les statuts" }, ...USER_ACCOUNT_STATUS_OPTIONS]}
          />
          {isSuperadminView ? (
            <label className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={pendingOnly}
                onChange={(e) => setPendingOnly(e.target.checked)}
              />
              En attente de validation uniquement
            </label>
          ) : null}
        </div>
        <div className="mt-4">
          <Table
            columns={columns}
            rows={filtered}
            rowKey={(u, i) => u.id ?? u.identifier ?? String(i)}
            onRowClick={setDetail}
          />
        </div>
      </Card>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.firstName ?? ""} ${detail.lastName ?? ""}`.trim() : ""}
        description={detail?.role}
        footer={
          detail ? (
            (() => {
              const detailPending = isPendingValidationStatus(detail.validationStatus ?? detail.status);
              const superCanManage =
                isSuperadminView &&
                session?.user &&
                canManageUserAccount(session.user, detail, "UPDATE");
              const superCanValidate =
                isSuperadminView &&
                session?.user &&
                canManageUserAccount(session.user, detail, "VALIDATE");
              // Tant que le compte est en attente, seul le Super Admin peut agir.
              if (detailPending) {
                return (
                  <>
                    {superCanValidate || canValidateAccount ? (
                      <Button variant="primary" disabled={busy} onClick={() => void validateAccount(detail)}>
                        Valider le compte
                      </Button>
                    ) : null}
                    {superCanManage ? (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setEditing(detail);
                            setDetail(null);
                          }}
                        >
                          Modifier
                        </Button>
                        <Button variant="danger" disabled={busy} onClick={() => void rejectAccount(detail)}>
                          Refuser
                        </Button>
                      </>
                    ) : (
                      <p className="text-sm text-muted">
                        En attente de validation par le Super Administrateur.
                      </p>
                    )}
                  </>
                );
              }
              const canEditTarget =
                canUpdate && (isSuperadminView ? canManageUserAccount(session?.user, detail, "UPDATE") : true);
              const canResetTarget = canResetTargetUserPassword(ctx, detail);
              const canSuspendTarget =
                canSuspend && (isSuperadminView ? canManageUserAccount(session?.user, detail, "SUSPEND") : true);
              return (
                <>
                  {canEditTarget ? (
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
                  {canResetTarget ? (
                    <Button variant="secondary" disabled={busy} onClick={() => void resetPassword(detail)}>
                      Réinitialiser le mot de passe
                    </Button>
                  ) : null}
                  {canSuspendTarget ? (
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
            {isCountryAdminProvisionedUser(detail) || detail.validationRequestedBy ? (
              <div className="mb-4 rounded-xl border border-amber/30 bg-amber/10 p-4 text-sm text-ink">
                <p className="font-bold text-amber">Créé par un Admin Pays</p>
                <p className="mt-1 text-muted">
                  Ce compte Admin École a été créé par un Admin Pays
                  {detail.validationRequestedBy ? ` (${detail.validationRequestedBy})` : ""}.
                  {isPendingValidationStatus(detail.validationStatus ?? detail.status)
                    ? " Le Super Administrateur doit le valider avant toute connexion."
                    : " Le Super Administrateur conserve la gestion complète de ce compte."}
                </p>
              </div>
            ) : null}
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <Row label="Identifiant" value={detail.identifier} />
              <Row label="Email" value={detail.email} />
              <Row label="Téléphone" value={detail.phone} />
              <Row label="Périmètre" value={detail.scopeLevel} />
              <Row label="Pays" value={detail.countryScope} />
              <Row label="Établissement" value={getUserEstablishmentLabel(detail, schoolsForLabels)} />
              <Row label="Canal" value={formatAccessChannelLabel(detail.accessChannel)} />
              <Row label="Statut" value={detail.status} />
              <Row label="Dernière connexion" value={detail.lastLoginAt ?? "—"} />
              <Row label="Validation" value={detail.validationStatus ?? "—"} />
            </dl>
          </>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={closeEditor}
        title={isEditingExisting ? "Modifier l'utilisateur" : "Nouvel utilisateur"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={closeEditor}>
              Annuler
            </Button>
            <Button form="user-form" type="submit" disabled={busy}>
              Enregistrer
            </Button>
          </>
        }
      >
        {editing ? (
          <form id="user-form" onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Rôle" hint={isSuperadminView ? "Admin Pays ou Admin School" : "Liste définie dans Configuration → Rôles"}>
              <Select
                value={editing.role}
                onChange={(e) => {
                  if (!session) return;
                  const nextRole = e.target.value;
                  setEditing(applyRoleChangeToUser(editing, nextRole, session, state));
                }}
                options={creatableRoles.map((r) => ({ value: r, label: r }))}
                disabled={isEditingExisting}
              />
            </Field>
            <Field label="Identifiant" hint="Généré automatiquement selon le rôle" required>
              <Input
                value={editing.identifier ?? ""}
                onChange={(e) => setEditing({ ...editing, identifier: e.target.value })}
                required
              />
            </Field>
            <Field label="Prénom" required>
              <Input
                value={editing.firstName ?? ""}
                onChange={(e) => setEditing({ ...editing, firstName: e.target.value })}
                required
              />
            </Field>
            <Field label="Nom" required>
              <Input
                value={editing.lastName ?? ""}
                onChange={(e) => setEditing({ ...editing, lastName: e.target.value })}
                required
              />
            </Field>
            <Field label="Genre">
              <Select
                value={editing.gender ?? "Non renseigné"}
                onChange={(e) => setEditing({ ...editing, gender: e.target.value })}
                options={[
                  { value: "Non renseigné", label: "Non renseigné" },
                  { value: "Masculin", label: "Masculin" },
                  { value: "Féminin", label: "Féminin" },
                ]}
              />
            </Field>
            <Field label="Téléphone">
              <Input value={editing.phone ?? ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={editing.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
            </Field>
            <Field label="Pays" hint="Périmètre géographique du compte">
              {fieldPolicy.countryScope === "select" ? (
                <Select
                  value={editing.countryScope ?? ""}
                  onChange={(e) => setEditing({ ...editing, countryScope: e.target.value })}
                  options={[
                    { value: "", label: "Sélectionner un pays" },
                    ...countryOptions,
                    ...(editing.countryScope &&
                    !countryOptions.some((option) => option.value === editing.countryScope)
                      ? [{ value: editing.countryScope, label: editing.countryScope }]
                      : []),
                  ]}
                />
              ) : fieldPolicy.countryScope === "readonly" ? (
                <Input value={editing.countryScope ?? ""} readOnly />
              ) : null}
            </Field>
            {fieldPolicy.scopeLevel !== "hidden" ? (
              <Field label="Périmètre">
                {fieldPolicy.scopeLevel === "select" ? (
                  <Select
                    value={editing.scopeLevel ?? "Établissement"}
                    onChange={(e) => setEditing({ ...editing, scopeLevel: e.target.value })}
                    options={[
                      { value: "Global", label: "Global" },
                      { value: "Pays", label: "Pays" },
                      { value: "Établissement", label: "Établissement" },
                    ]}
                  />
                ) : (
                  <Input value={editing.scopeLevel ?? ""} readOnly />
                )}
              </Field>
            ) : null}
            {fieldPolicy.schoolCode !== "hidden" ? (
              <Field
                label="Établissement"
                hint={
                  isSuperadminView || isCountryAdminView
                    ? "Admin école rattaché à un établissement précis"
                    : "Périmètre autorisé du compte"
                }
              >
                {fieldPolicy.schoolCode === "select" ? (
                  <Select
                    value={editing.schoolCode ?? ""}
                    onChange={(e) => {
                      const schoolCode = e.target.value;
                      const selected = schoolsForLabels.find((item) => item.code === schoolCode);
                      setEditing({
                        ...editing,
                        schoolCode,
                        countryScope: selected
                          ? resolveCountryScopeFromSchool(selected, editing.countryScope ?? "")
                          : editing.countryScope,
                      });
                    }}
                    options={[
                      { value: "", label: "Sélectionner un établissement" },
                      ...schoolOptions,
                    ]}
                  />
                ) : (
                  <Input value={getUserEstablishmentLabel(editing, schoolsForLabels)} readOnly />
                )}
              </Field>
            ) : null}
            {fieldPolicy.accessChannel !== "hidden" ? (
              <Field label="Canal d'accès">
                {fieldPolicy.accessChannel === "select" ? (
                  <Select
                    value={editing.accessChannel ?? "Application"}
                    onChange={(e) => setEditing({ ...editing, accessChannel: e.target.value })}
                    options={[
                      { value: "Application", label: "Application" },
                      { value: "BackOffice", label: "Plateforme" },
                    ]}
                  />
                ) : (
                  <Input value={editing.accessChannel ?? "Application"} readOnly />
                )}
              </Field>
            ) : null}
            {!isEditingExisting && isPendingValidationStatus(editing.status) ? (
              <Field label="Statut" hint="Validation requise">
                <Input value={PENDING_VALIDATION_STATUS} readOnly />
              </Field>
            ) : (
              <Field label="Statut">
                <Select
                  value={editing.status ?? "Actif"}
                  onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                  options={USER_ACCOUNT_STATUS_OPTIONS}
                />
              </Field>
            )}
            {!isEditingExisting && isPendingValidationStatus(editing.status) ? (
              <div className="sm:col-span-2 rounded-xl border border-amber/30 bg-amber/10 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-amber">
                  Validation Super Admin requise
                </p>
                <p className="mt-1 text-sm text-muted">
                  En tant qu'Admin Pays, vous pouvez créer ce compte Admin École, mais il restera
                  « {PENDING_VALIDATION_STATUS} » et ne pourra pas se connecter tant qu'un Super
                  Administrateur ne l'aura pas validé.
                </p>
              </div>
            ) : null}
            {!isEditingExisting && editing.temporaryPassword ? (
              <div className="sm:col-span-2 rounded-xl border border-brand/20 bg-brand-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-brand">Mot de passe temporaire</p>
                <p className="mt-1 font-mono text-lg font-black text-ink">{editing.temporaryPassword}</p>
                <p className="mt-1 text-xs text-muted">
                  Communiquez ce mot de passe à l'utilisateur. Il devra le changer à la première connexion.
                </p>
              </div>
            ) : null}
          </form>
        ) : null}
      </Modal>
    </>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{value || "—"}</dd>
    </div>
  );
}
