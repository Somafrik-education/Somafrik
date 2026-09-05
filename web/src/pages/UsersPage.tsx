import { useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { useData } from "../context/DataContext";
import { projectScopedUsers, scopedCountries, scopedSchools } from "../lib/scope";
import { getCurrentSchool } from "../lib/establishment";
import { isInternalSchoolRole, normalize, getInitials, getCountryCodeFromScope } from "../lib/format";
import { formatCaughtApiError } from "../lib/apiErrors";
import { canManageRolePermissions, canResetTargetUserPassword } from "../lib/permissions";
import { USER_ACCOUNT_STATUS_OPTIONS, validatePasswordPolicy } from "../lib/userAccountRules";
import { useFeaturePermissions, usePermissionContext } from "../lib/usePermissionContext";
import {
  applyRoleChangeToUser,
  buildNewUserDraft,
  canManageUserAccount,
  canReassignUserTenant,
  canSuperadminManageUser,
  formatAccessChannelLabel,
  getCountryScopeOptions,
  formatAccessRolesDisplay,
  formatBusinessProfileKind,
  getCreatableUserRoles,
  getUserEstablishmentLabel,
  getUserFormFieldPolicy,
  isCountryAdminProvisionedUser,
  isStudentLinkedAccount,
  canAssignRoleToUserAccount,
  accountKindLabel,
  isTeacherRoleLabel,
  STUDENT_TEACHER_ROLE_CONFLICT_MESSAGE,
  schoolsMatchingCountryScope,
  toCreateUserApiPayload,
  toProvisionUserApiPayload,
  toUpdateUserIdentityPayload,
  validateUserAccount,
  resetUserAccountPassword,
  isSuperadminDirectUserRole,
} from "../lib/userAccounts";
import { clientsApi } from "../lib/clientsApi";
import {
  COUNTRY_ADMIN_ROLE,
  isPendingValidationStatus,
  isSuperAdminRole,
  PENDING_VALIDATION_STATUS,
  SCHOOL_ADMIN_ROLE,
  VALIDATED_STATUS,
} from "../lib/orgHierarchy";

import { InlineAlert } from "@/design-system";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PrintButton } from "../components/ui/PrintButton";
import { StatusBadge } from "../components/ui/Badge";
import { Table, type Column } from "../components/ui/Table";
import { Modal } from "../components/ui/Modal";
import { Field, Input, Select } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { usePrompt } from "../components/ui/PromptDialog";
import type { UserAccount } from "../types";

function toCsv(users: UserAccount[]): string {
  const headers = ["Prénom", "Nom", "Identifiant", "Type métier", "Rôle(s) d'accès", "Email", "Téléphone", "Établissement", "Pays", "Statut"];
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = users.map((u) =>
    [u.firstName, u.lastName, u.publicId ?? u.identifier, formatBusinessProfileKind(u), formatAccessRolesDisplay(u), u.email, u.phone, getUserEstablishmentLabel(u), u.countryScope, u.status]
      .map(escape)
      .join(","),
  );
  return [headers.map(escape).join(","), ...lines].join("\r\n");
}

export function UsersPage() {
  const { session } = useAuth();
  const { scopedUser, activeSchoolCode } = useActiveSchool();
  const { state, refresh, error: dataError, scopeError } = useData();
  const ctx = usePermissionContext();
  const scopeUser = scopedUser ?? session?.user ?? null;
  const { showToast } = useToast();
  const { prompt } = usePrompt();

  const usersProjection = projectScopedUsers(scopeUser, state);
  const allUsers = usersProjection.users;
  const visibleScopeError = scopeError || usersProjection.error?.message || null;
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
  const [assigning, setAssigning] = useState<UserAccount | null>(null);
  const [assignableRoles, setAssignableRoles] = useState<Array<{ roleKey: string; roleName: string }>>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [reassigning, setReassigning] = useState<UserAccount | null>(null);
  const [reassignCountry, setReassignCountry] = useState("");
  const [reassignSchool, setReassignSchool] = useState("");

  const creatableRoles = useMemo(
    () => getCreatableUserRoles(scopeUser, state, schoolCode),
    [scopeUser, state, schoolCode],
  );

  const roleOptions = useMemo(() => {
    const labels = [...creatableRoles, ...allUsers.map((user) => user.role)].filter(isCanonicalRoleLabel);
    return [...new Set(labels)];
  }, [allUsers, creatableRoles]);

  const countryOptions = useMemo(
    () => getCountryScopeOptions(scopedCountries(scopeUser, state)),
    [scopeUser, state],
  );

  const schoolOptions = useMemo(() => {
    const source = isSuperadminView
      ? schoolsMatchingCountryScope(schoolsForLabels, editing?.countryScope)
      : schoolsForLabels;
    return source.map((item) => ({
      value: item.code,
      label: `${item.name} (${item.code})`,
    }));
  }, [editing?.countryScope, isSuperadminView, schoolsForLabels]);

  const isEditingExisting = Boolean(editing?.id && state.users.some((u) => u.id === editing.id));
  const fieldPolicy = getUserFormFieldPolicy(scopeUser, editing?.role ?? "", {
    mode: isEditingExisting ? "edit" : "create",
  });
  const allowedSchoolCodes = useMemo(
    () => schoolOptions.map((option) => normalize(option.value)),
    [schoolOptions],
  );
  const countrySelected = Boolean(String(editing?.countryScope ?? "").trim());
  const schoolSelectDisabled = isSuperadminView && !countrySelected;

  const filtered = useMemo(() => {
    const q = normalize(search);
    return allUsers.filter((u) => {
      const matchesQuery =
        !q ||
        [u.firstName, u.lastName, u.identifier, u.publicId, formatBusinessProfileKind(u), formatAccessRolesDisplay(u), u.schoolCode, u.email].some((v) =>
          normalize(v).includes(q),
        );
      const matchesRole =
        !roleFilter ||
        formatAccessRolesDisplay(u) === roleFilter ||
        formatBusinessProfileKind(u) === roleFilter ||
        (u.roles ?? []).includes(roleFilter) ||
        u.role === roleFilter;
      const matchesStatus = !statusFilter || String(u.status ?? "Actif") === statusFilter;
      const matchesPending =
        !pendingOnly || isPendingValidationStatus(u.validationStatus ?? u.status);
      return matchesQuery && matchesRole && matchesStatus && matchesPending;
    });
  }, [allUsers, search, roleFilter, statusFilter, pendingOnly]);

  async function persistUserPatch(user: UserAccount, patch: Partial<UserAccount>, message: string) {
    setBusy(true);
    try {
      try {
        await clientsApi.updateUser(String(user.id), toUpdateUserIdentityPayload({ ...user, ...patch }));
      } catch (error) {
        showToast(formatCaughtApiError(error, "Échec de la modification d'identité"), "error");
        throw error;
      }
      try {
        await refresh();
      } catch (error) {
        showToast(formatCaughtApiError(error, "Échec du rechargement après enregistrement"), "error");
        throw error;
      }
      showToast(message, "success");
    } finally {
      setBusy(false);
    }
  }

  async function persistUsers(_next: UserAccount[], message: string, syncedUser?: UserAccount) {
    setBusy(true);
    try {
      if (syncedUser) {
        const exists = Boolean(syncedUser.id) && state.users.some((u) => u.id === syncedUser.id);
        if (exists) {
          try {
            await clientsApi.updateUser(String(syncedUser.id), toUpdateUserIdentityPayload(syncedUser));
          } catch (error) {
            showToast(formatCaughtApiError(error, "Échec de la modification d'identité"), "error");
            throw error;
          }
        } else {
          try {
            const shouldProvision =
              isSuperAdminRole(session?.user?.role) && isSuperadminDirectUserRole(syncedUser.role);
            const created = (
              shouldProvision
                ? await clientsApi.provisionUser(toProvisionUserApiPayload(syncedUser))
                : await clientsApi.createUser(toCreateUserApiPayload(syncedUser))
            ) as UserAccount;
            if (created.temporaryPassword) {
              showToast(`Mot de passe temporaire : ${created.temporaryPassword}`, "success");
            }
            if (!shouldProvision && syncedUser.role && created?.id) {
              await clientsApi.grantUserRole(String(created.id), syncedUser.role);
            }
          } catch (error) {
            showToast(formatCaughtApiError(error, "Échec de la création"), "error");
            throw error;
          }
        }
      }
      try {
        await refresh();
      } catch (error) {
        showToast(formatCaughtApiError(error, "Échec du rechargement après enregistrement"), "error");
        throw error;
      }
      showToast(message, "success");
    } finally {
      setBusy(false);
    }
  }

  async function toggleSuspend(user: UserAccount) {
    const nextStatus = user.status === "Suspendu" ? "Actif" : "Suspendu";
    try {
      await persistUserPatch(user, { status: nextStatus }, `Compte ${nextStatus.toLowerCase()}`);
      setDetail(null);
    } catch {
      /* toast déjà affiché */
    }
  }

  async function rejectAccount(user: UserAccount) {
    if (!isSuperadminView || !canSuperadminManageUser(user)) return;
    try {
      await persistUserPatch(user, { status: "Archivé" }, "Compte refusé et archivé");
      setDetail(null);
    } catch {
      /* toast déjà affiché */
    }
  }

  async function validateAccount(user: UserAccount) {
    try {
      await persistUserPatch(
        user,
        {
          status: "Actif",
          validationStatus: VALIDATED_STATUS,
          validatedBy: session?.user?.identifier ?? session?.user?.firstName ?? "Super administrateur",
          validatedAt: new Date().toISOString(),
        },
        "Compte validé. L’administrateur de l’établissement peut désormais se connecter.",
      );
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
      required: true,
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
      schools: schoolsForLabels,
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
    };

    try {
      await persistUsers(state.users, exists ? "Utilisateur modifié" : "Utilisateur créé", payload);
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
    setEditing(buildNewUserDraft("", session, state));
    setDetail(null);
  }

  async function openAssignFlow(user: UserAccount) {
    setAssigning(user);
    setDetail(null);
    setSelectedRoles(user.roles?.length ? [...user.roles] : user.role && user.role !== "Sans affectation" ? [user.role] : []);
    try {
      const response = await clientsApi.listAssignableRoles();
      const roles = Array.isArray(response?.roles) ? response.roles : [];
      setAssignableRoles(roles.filter(isCanonicalAssignableRole).filter(isAdministrableAssignableRole));
    } catch {
      setAssignableRoles(
        creatableRoles.filter(isCanonicalRoleLabel).filter(isAdministrableRoleLabel).map((roleName) => ({
          roleKey: roleName,
          roleName,
        })),
      );
    }
  }

  async function submitAssign() {
    if (!assigning?.id) return;
    const current = new Set(assigning.roles?.length ? assigning.roles : assigning.role && assigning.role !== "Sans affectation" ? [assigning.role] : []);
    const next = new Set(selectedRoles);
    setBusy(true);
    try {
      for (const role of next) {
        if (!current.has(role)) {
          if (!canAssignRoleToUserAccount(assigning, role)) {
            showToast(STUDENT_TEACHER_ROLE_CONFLICT_MESSAGE, "error");
            return;
          }
          await clientsApi.grantUserRole(String(assigning.id), role);
        }
      }
      for (const role of current) {
        if (!next.has(role)) {
          await clientsApi.revokeUserRole(String(assigning.id), role);
        }
      }
      await refresh();
      showToast("Rôles mis à jour.", "success");
      setAssigning(null);
    } catch (error) {
      showToast(formatCaughtApiError(error, "Échec de l'attribution des rôles"), "error");
    } finally {
      setBusy(false);
    }
  }

  function closeEditor() {
    setEditing(null);
  }

  function openReassignFlow(user: UserAccount) {
    setEditing(null);
    setReassigning(user);
    setReassignCountry(user.countryScope ?? "");
    setReassignSchool("");
  }

  function closeReassignFlow() {
    setReassigning(null);
    setReassignCountry("");
    setReassignSchool("");
  }

  async function submitReassign() {
    if (!reassigning?.id) return;
    const schoolCode = String(reassignSchool ?? "").trim();
    const countryCode = getCountryCodeFromScope(reassignCountry);
    if (!schoolCode) {
      showToast("Sélectionnez le nouvel établissement.", "error");
      return;
    }
    setBusy(true);
    try {
      try {
        await clientsApi.reassignUserSchool(String(reassigning.id), {
          schoolCode,
          ...(countryCode ? { countryCode } : {}),
        });
      } catch (error) {
        showToast(formatCaughtApiError(error, "Échec de la réaffectation d'établissement"), "error");
        throw error;
      }
      try {
        await refresh();
      } catch (error) {
        showToast(formatCaughtApiError(error, "Échec du rechargement après réaffectation"), "error");
        throw error;
      }
      showToast("Établissement réaffecté. Les sessions existantes ont été révoquées.", "success");
      closeReassignFlow();
      setEditing(null);
    } catch {
      /* toast déjà affiché */
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const blob = new Blob(["\uFEFF" + toCsv(filtered)], { type: "text/csv;charset=utf-8;" });
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
            <p className="text-xs text-muted">{u.publicId ?? u.identifier}</p>
            {accountKindLabel(u) ? (
              <p className={`text-xs font-semibold ${u.accountKind === "conflict" ? "text-red-700" : "text-brand"}`}>
                {accountKindLabel(u)}
              </p>
            ) : null}
          </div>
        </div>
      ),
    },
    { key: "publicId", header: "Identifiant", render: (u) => u.publicId ?? u.identifier ?? "—" },
    { key: "status", header: "Statut", render: (u) => <StatusBadge status={u.status} /> },
    { key: "accountKind", header: "Type métier", render: (u) => formatBusinessProfileKind(u) },
    { key: "roles", header: "Rôle(s) d'accès", render: (u) => formatAccessRolesDisplay(u) },
    {
      key: "actions",
      header: "Actions",
      render: (u) => {
        const canEditTarget =
          canUpdate && (isSuperadminView ? canManageUserAccount(session?.user, u, "UPDATE") : true);
        return (
          <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
            {canEditTarget ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setEditing(u);
                    setDetail(null);
                  }}
                >
                  Modifier
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void openAssignFlow(u)}>
                  Attribuer
                </Button>
              </>
            ) : null}
          </div>
        );
      },
    },
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

  const reassignSchoolOptions = useMemo(() => {
    const source = isSuperadminView
      ? schoolsMatchingCountryScope(schoolsForLabels, reassignCountry)
      : schoolsForLabels;
    return source.map((item) => ({
      value: item.code,
      label: `${item.name} (${item.code})`,
    }));
  }, [isSuperadminView, reassignCountry, schoolsForLabels]);
  const canShowReassign =
    Boolean(editing) &&
    isEditingExisting &&
    canUpdate &&
    canReassignUserTenant(scopeUser, editing);

  const usersDescription = visibleScopeError
    ? "Les comptes ne peuvent pas être affichés tant que le périmètre établissement n'est pas cohérent."
    : isSuperadminView
      ? `${filtered.length} compte(s) plateforme. Le Super administrateur valide et gère les Administrateurs établissement créés par les Administrateurs pays.`
      : isCountryAdminView
        ? `${filtered.length} administrateur(s) d’établissement dans votre pays. Les comptes métier (secrétaire, enseignant…) se gèrent dans Configuration établissement.`
        : `${filtered.length} compte(s) accessibles.`;

  return (
    <>
      {visibleScopeError ? (
        <InlineAlert tone="danger" title="Périmètre établissement">
          {visibleScopeError}
        </InlineAlert>
      ) : null}
      {dataError && !visibleScopeError ? (
        <InlineAlert tone="danger" title="Chargement utilisateurs">
          {dataError}
        </InlineAlert>
      ) : null}
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
          description={usersDescription}
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
        description={detail ? `${formatBusinessProfileKind(detail)} · ${formatAccessRolesDisplay(detail)}` : undefined}
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
                      <Button variant="secondary" onClick={() => void openAssignFlow(detail)}>
                        Attribuer
                      </Button>
                    </>
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
                <p className="font-bold text-amber">Créé par un Administrateur pays</p>
                <p className="mt-1 text-muted">
                  Ce compte Administrateur établissement a été créé par un Administrateur pays
                  {detail.validationRequestedBy ? ` (${detail.validationRequestedBy})` : ""}.
                  {isPendingValidationStatus(detail.validationStatus ?? detail.status)
                    ? " Le Super Administrateur doit le valider avant toute connexion."
                    : " Le Super Administrateur conserve la gestion complète de ce compte."}
                </p>
              </div>
            ) : null}
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <Row label="Identifiant" value={detail.publicId ?? detail.identifier} />
              <Row label="Type métier" value={formatBusinessProfileKind(detail)} />
              <Row label="Rôle(s) d'accès" value={formatAccessRolesDisplay(detail)} />
              {detail.linkedStudent?.studentCode ? (
                <Row label="Profil élève" value={detail.linkedStudent.studentCode} />
              ) : null}
              <Row label="Email" value={detail.email} />
              <Row label="Téléphone" value={detail.phone} />
              <Row label="Périmètre" value={detail.scopeLevel} />
              <Row label="Pays" value={detail.countryScope} />
              <Row label="Établissement" value={getUserEstablishmentLabel(detail)} />
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
            {isEditingExisting ? (
              <Field label="Identifiant" hint="Généré par le serveur, non modifiable">
                <Input value={editing.publicId ?? editing.identifier ?? ""} readOnly />
              </Field>
            ) : (
              <p className="sm:col-span-2 text-sm text-muted">
                {isSuperadminView
                  ? "Administrateur pays et Administrateur établissement sont créés directement avec leur rôle. Sans affectation crée uniquement l'identité."
                  : "L'identifiant (UUID et code USR) est généré côté serveur. Aucun rôle n'est attribué à la création. Utilisez ensuite Attribuer."}
              </p>
            )}
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
            {!isEditingExisting ? (
              <Field
                label="Rôle"
                hint={
                  isSuperadminView
                    ? "Le rôle est créé immédiatement à l'enregistrement"
                    : "L'identité est créée d'abord, puis le rôle est attribué"
                }
                required={isSuperadminView}
              >
                <Select
                  value={editing.role ?? ""}
                  onChange={(e) => {
                    if (!session) return;
                    setEditing(applyRoleChangeToUser(editing, e.target.value, session, state));
                  }}
                  options={[
                    { value: "", label: "Sans affectation (plus tard)" },
                    ...creatableRoles.map((role) => ({ value: role, label: role })),
                  ]}
                />
              </Field>
            ) : null}
            <Field
              label="Pays"
              hint={
                isEditingExisting
                  ? "Lecture seule. La réaffectation d'établissement est une action distincte."
                  : "Périmètre géographique du compte"
              }
              required={!isEditingExisting && (editing.role === SCHOOL_ADMIN_ROLE || editing.role === COUNTRY_ADMIN_ROLE)}
            >
              {fieldPolicy.countryScope === "select" ? (
                <Select
                  value={editing.countryScope ?? ""}
                  onChange={(e) => {
                    const countryScope = e.target.value;
                    const keepGlobalSchool =
                      editing.role === COUNTRY_ADMIN_ROLE || editing.schoolCode === "*";
                    setEditing({
                      ...editing,
                      countryScope,
                      schoolCode: keepGlobalSchool ? "*" : "",
                    });
                  }}
                  options={[
                    { value: "", label: "Choisir un pays..." },
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
                required={editing.role === SCHOOL_ADMIN_ROLE || (isCountryAdminView && !isEditingExisting)}
                hint={
                  isEditingExisting
                    ? "Lecture seule. Utilisez « Réaffecter l'établissement » pour changer le tenant PostgreSQL."
                    : isSuperadminView && editing.role === COUNTRY_ADMIN_ROLE
                      ? "Aucun établissement — périmètre national uniquement"
                      : isSuperadminView || isCountryAdminView
                        ? "Administrateur établissement rattaché à un établissement précis"
                        : "Périmètre autorisé du compte"
                }
              >
                {fieldPolicy.schoolCode === "select" ? (
                  <Select
                    value={editing.schoolCode ?? ""}
                    disabled={schoolSelectDisabled}
                    onChange={(e) => {
                      const schoolCode = e.target.value;
                      setEditing({
                        ...editing,
                        schoolCode,
                      });
                    }}
                    options={[
                      {
                        value: "",
                        label: schoolSelectDisabled
                          ? "Choisir un pays d'abord"
                          : "Sélectionner un établissement",
                      },
                      ...schoolOptions,
                    ]}
                  />
                ) : (
                  <Input value={getUserEstablishmentLabel(editing)} readOnly />
                )}
              </Field>
            ) : null}
            {canShowReassign ? (
              <div className="sm:col-span-2 rounded-xl border border-amber/30 bg-amber/10 p-4">
                <p className="text-sm font-semibold text-ink">Réaffectation d'établissement</p>
                <p className="mt-1 text-sm text-muted">
                  Changer le pays ou l'établissement n'est pas une modification d'identité. Cette action met à jour
                  l’établissement et les rôles actifs associés et révoque immédiatement les sessions existantes.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-3"
                  disabled={busy}
                  onClick={() => editing && openReassignFlow(editing)}
                >
                  Réaffecter l'établissement
                </Button>
              </div>
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
                  Validation du Super administrateur requise
                </p>
                <p className="mt-1 text-sm text-muted">
                  En tant qu’Administrateur pays, vous pouvez créer ce compte Administrateur établissement, mais il restera
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

      <Modal
        open={Boolean(assigning)}
        onClose={() => setAssigning(null)}
        title="Attribuer les rôles"
        description={assigning ? `${assigning.firstName ?? ""} ${assigning.lastName ?? ""}`.trim() : ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssigning(null)}>
              Annuler
            </Button>
            <Button disabled={busy} onClick={() => void submitAssign()}>
              Enregistrer
            </Button>
          </>
        }
      >
        <div className="grid gap-2">
          {assigning && isStudentLinkedAccount(assigning) ? (
            <p className="rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-ink">
              {STUDENT_TEACHER_ROLE_CONFLICT_MESSAGE}
            </p>
          ) : null}
          {assignableRoles.length === 0 ? (
            <p className="text-sm text-muted">Aucun rôle attribuable pour votre périmètre.</p>
          ) : (
            assignableRoles.map((role) => {
              const incompatible = assigning ? !canAssignRoleToUserAccount(assigning, role.roleName) : false;
              return (
              <label key={role.roleKey} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedRoles.includes(role.roleName)}
                  disabled={incompatible}
                  onChange={(event) => {
                    if (incompatible) return;
                    setSelectedRoles((current) =>
                      event.target.checked
                        ? [...current, role.roleName]
                        : current.filter((item) => item !== role.roleName),
                    );
                  }}
                />
                {role.roleName}
                {incompatible && isTeacherRoleLabel(role.roleName) ? (
                  <span className="text-xs text-muted">incompatible avec un profil élève</span>
                ) : null}
              </label>
              );
            })
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(reassigning)}
        onClose={closeReassignFlow}
        title="Réaffecter l'établissement"
        description={
          reassigning
            ? `${reassigning.firstName ?? ""} ${reassigning.lastName ?? ""}`.trim()
            : ""
        }
        footer={
          <>
            <Button variant="secondary" onClick={closeReassignFlow}>
              Annuler
            </Button>
            <Button variant="danger" disabled={busy || !reassignSchool} onClick={() => void submitReassign()}>
              Confirmer la réaffectation
            </Button>
          </>
        }
      >
        {reassigning ? (
          <div className="grid gap-4">
            <p className="text-sm text-muted">
              Cette action rattache le compte à un autre établissement PostgreSQL, aligne les rôles actifs
              sur le même school_id, et révoque immédiatement les sessions JWT existantes. L'accès à l'ancien
              tenant sera refusé.
            </p>
            <Field label="Pays" required={isSuperadminView}>
              {isSuperadminView ? (
                <Select
                  value={reassignCountry}
                  onChange={(event) => {
                    setReassignCountry(event.target.value);
                    setReassignSchool("");
                  }}
                  options={[
                    { value: "", label: "Choisir un pays..." },
                    ...countryOptions,
                  ]}
                />
              ) : (
                <Input value={reassignCountry} readOnly />
              )}
            </Field>
            <Field label="Nouvel établissement" required>
              <Select
                value={reassignSchool}
                disabled={isSuperadminView && !String(reassignCountry).trim()}
                onChange={(event) => setReassignSchool(event.target.value)}
                options={[
                  {
                    value: "",
                    label:
                      isSuperadminView && !String(reassignCountry).trim()
                        ? "Choisir un pays d'abord"
                        : "Sélectionner un établissement",
                  },
                  ...reassignSchoolOptions,
                ]}
              />
            </Field>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function isCanonicalRoleLabel(role: string | undefined | null): role is string {
  return typeof role === "string" && role.trim().length > 0 && role !== "Sans affectation";
}

function isAdministrableRoleLabel(role: string): boolean {
  return role !== "Parent" && role !== "Élève / Étudiant";
}

function isCanonicalAssignableRole(
  role: { roleKey?: string; roleName?: string },
): role is { roleKey: string; roleName: string } {
  return Boolean(role.roleKey?.trim() && role.roleName?.trim());
}

function isAdministrableAssignableRole(role: { roleName: string }): boolean {
  return isAdministrableRoleLabel(role.roleName);
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{value || "—"}</dd>
    </div>
  );
}
