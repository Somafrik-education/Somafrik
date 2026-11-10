import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { canManageRolePermissions } from "../lib/permissions";
import { formatCountryOption, formatSchoolOption, schoolsForCountry } from "../lib/superadminCrudPath";
import { scopedCountries, scopedSchools } from "../lib/scope";
import { usePermissionContext } from "../lib/usePermissionContext";
import { displayScopeName, displayStatusName } from "../lib/format";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { PrintButton } from "../components/ui/PrintButton";
import { Field, Input, Select } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { ApiError } from "../api/client";
import {
  rbacApi,
  type RbacCatalog,
  type RbacConfiguredMatrix,
  type RbacCrudFlags,
  type RbacCrudGrant,
  type RbacHistoryItem,
  type RbacRole,
} from "../lib/rbacApi";
import {
  applyMandatoryOverlay,
  crudFlagsEqual,
  describeActionLock,
  lockTooltip,
  mandatoryFlagsForModule,
  toggleCrudFlag,
  type RbacAction,
} from "../lib/rbacLocks";
import { resolveEffectiveRoleLabel } from "../lib/roleDisplayLabels";

const CRUD_ACTIONS = [
  { key: "canCreate" as const, action: "create" as RbacAction, label: "Création" },
  { key: "canRead" as const, action: "read" as RbacAction, label: "Lecture" },
  { key: "canUpdate" as const, action: "update" as RbacAction, label: "Modification" },
  { key: "canDelete" as const, action: "delete" as RbacAction, label: "Suppression" },
];

function LockIcon({ label }: { label: string }) {
  return (
    <span className="inline-flex text-slate-500" title={label} aria-hidden="true">
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor">
        <path d="M10 2a4 4 0 00-4 4v2H5a1 1 0 00-1 1v7a1 1 0 001 1h10a1 1 0 001-1V9a1 1 0 00-1-1h-1V6a4 4 0 00-4-4zm-2 6V6a2 2 0 114 0v2H8z" />
      </svg>
    </span>
  );
}

type TabKey = "permissions" | "roles" | "history";

const HISTORY_PAGE_SIZE = 20;

function isProtectedRole(role: RbacRole, catalog: RbacCatalog | null) {
  const code = String(role.roleCode || "").toUpperCase();
  return Boolean(role.systemProtected) || Boolean(catalog?.protectedRoleKeys?.includes(code));
}

function emptyCrud(): RbacCrudFlags {
  return { canCreate: false, canRead: false, canUpdate: false, canDelete: false };
}

function toCrudFlags(source?: Partial<RbacCrudFlags> | null): RbacCrudFlags {
  return {
    canCreate: source?.canCreate === true,
    canRead: source?.canRead === true,
    canUpdate: source?.canUpdate === true,
    canDelete: source?.canDelete === true,
  };
}

function toCrudGrant(moduleKey: string, source?: Partial<RbacCrudFlags> | null): RbacCrudGrant {
  return {
    moduleKey,
    ...toCrudFlags(source),
  };
}

const DISCARD_DIRTY_CONFIRM =
  "Des modifications ne sont pas encore enregistrées. Abandonner ces changements ?";

function sourceLabel(source?: string) {
  if (source === "school") return "Établissement";
  if (source === "country") return "Pays";
  if (source === "global") return "Global";
  return "Refus par défaut";
}

function sortModules<T extends { moduleKey: string; moduleName?: string; displayOrder?: number }>(
  modules: T[],
  catalogModules: Array<{ moduleKey: string; displayOrder?: number }> = [],
) {
  const catalogOrder = new Map(
    catalogModules.map((module, index) => [module.moduleKey, module.displayOrder ?? (index + 1) * 10]),
  );
  return [...modules].sort((left, right) => {
    const leftOrder = left.displayOrder ?? catalogOrder.get(left.moduleKey) ?? 9999;
    const rightOrder = right.displayOrder ?? catalogOrder.get(right.moduleKey) ?? 9999;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(left.moduleName ?? left.moduleKey).localeCompare(String(right.moduleName ?? right.moduleKey), "fr");
  });
}

function confirmDiscardDirty(dirtyCount: number) {
  if (dirtyCount <= 0) return true;
  return window.confirm(DISCARD_DIRTY_CONFIRM);
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-FR");
}

export function PermissionsPage() {
  const { session } = useAuth();
  const { state } = useData();
  const ctx = usePermissionContext();
  const { showToast } = useToast();
  const canManage = canManageRolePermissions(ctx);
  const user = session?.user ?? null;

  const countries = scopedCountries(user, state);
  const allSchools = scopedSchools(user, state);

  const [tab, setTab] = useState<TabKey>("permissions");
  const [catalog, setCatalog] = useState<RbacCatalog | null>(null);
  const [countryCode, setCountryCode] = useState("");
  const [schoolCode, setSchoolCode] = useState("");
  const [selectedRoleKey, setSelectedRoleKey] = useState("");
  const [matrix, setMatrix] = useState<RbacConfiguredMatrix | null>(null);
  const [draftByModule, setDraftByModule] = useState<Record<string, RbacCrudFlags>>({});
  const [busy, setBusy] = useState(false);
  const [roleForm, setRoleForm] = useState({ roleName: "", roleCode: "" });
  const [editingRoleId, setEditingRoleId] = useState("");
  const [editingRoleName, setEditingRoleName] = useState("");
  const [editingDisplayRoleId, setEditingDisplayRoleId] = useState("");
  const [editingDisplayLabel, setEditingDisplayLabel] = useState("");
  const [historyItems, setHistoryItems] = useState<RbacHistoryItem[]>([]);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE_SIZE);

  const countryOptions = useMemo(
    () => [{ value: "", label: "Choisir un pays…" }, ...countries.map(formatCountryOption)],
    [countries],
  );
  const schoolsInCountry = useMemo(
    () => schoolsForCountry(allSchools, countryCode),
    [allSchools, countryCode],
  );
  const schoolOptions = useMemo(
    () => [
      { value: "", label: countryCode ? "Choisir un établissement…" : "Sélectionnez d'abord un pays" },
      ...schoolsInCountry.map(formatSchoolOption),
    ],
    [countryCode, schoolsInCountry],
  );

  const roles = catalog?.roles ?? [];
  const activeRoles = roles.filter((role) => role.status === "active");
  const roleOptions = useMemo(
    () => [
      {
        value: "",
        label: schoolCode ? "Choisir le rôle cible…" : "Sélectionnez d'abord un établissement",
      },
      ...activeRoles.map((role) => ({
        value: role.roleCode,
        label: `${role.effectiveLabel || role.roleName} (${role.roleCode})`,
      })),
    ],
    [activeRoles, schoolCode],
  );

  const matrixModules = useMemo(
    () => sortModules(matrix?.modules ?? [], catalog?.modules ?? []),
    [matrix?.modules, catalog?.modules],
  );

  const selectedCountry = countries.find((country) => country.code === countryCode);
  const selectedSchool = schoolsInCountry.find((school) => school.code === schoolCode);
  const selectedRole = roles.find((role) => role.roleCode === selectedRoleKey);
  const pathComplete = Boolean(countryCode && schoolCode && selectedRoleKey);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    void rbacApi
      .getCatalog()
      .then((payload) => {
        if (!cancelled) setCatalog(payload);
      })
      .catch(() => {
        if (!cancelled) showToast("Impossible de charger le catalogue des rôles.", "error");
      });
    return () => {
      cancelled = true;
    };
    // showToast est stable via ToastProvider ; exclu pour éviter une boucle de fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  useEffect(() => {
    if (!canManage || !selectedRoleKey || !countryCode || !schoolCode) return;
    let cancelled = false;
    setBusy(true);
    void rbacApi
      .getConfigured({ roleKey: selectedRoleKey, countryCode, schoolCode })
      .then((payload) => {
        if (cancelled) return;
        setMatrix(payload);
        const nextDraft: Record<string, RbacCrudFlags> = {};
        for (const module of payload.modules ?? []) {
          const mandatory = mandatoryFlagsForModule(catalog?.mandatoryByRole, selectedRoleKey, module.moduleKey);
          nextDraft[module.moduleKey] = applyMandatoryOverlay(toCrudFlags(module), mandatory);
        }
        setDraftByModule(nextDraft);
      })
      .catch(() => {
        if (!cancelled) showToast("Impossible de charger la matrice des droits.", "error");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, selectedRoleKey, countryCode, schoolCode, catalog?.mandatoryByRole]);

  const loadedByModule = useMemo(() => {
    const next: Record<string, RbacCrudFlags> = {};
    for (const module of matrixModules) {
      const mandatory = mandatoryFlagsForModule(catalog?.mandatoryByRole, selectedRoleKey, module.moduleKey);
      next[module.moduleKey] = applyMandatoryOverlay(toCrudFlags(module), mandatory);
    }
    return next;
  }, [matrixModules, catalog?.mandatoryByRole, selectedRoleKey]);

  const dirtyModuleKeys = useMemo(
    () =>
      matrixModules
        .map((module) => module.moduleKey)
        .filter((moduleKey) => {
          const draft = draftByModule[moduleKey];
          const loaded = loadedByModule[moduleKey];
          if (!draft || !loaded) return false;
          return !crudFlagsEqual(draft, loaded);
        }),
    [matrixModules, draftByModule, loadedByModule],
  );
  const dirtyCount = dirtyModuleKeys.length;
  const dirty = dirtyCount > 0;

  function applyScope(nextCountry: string, nextSchool: string, nextRole: string) {
    setCountryCode(nextCountry);
    setSchoolCode(nextSchool);
    setSelectedRoleKey(nextRole);
    setMatrix(null);
    setDraftByModule({});
  }

  function onCountryChange(nextCountry: string) {
    if (nextCountry === countryCode) return;
    if (!confirmDiscardDirty(dirtyCount)) return;
    applyScope(nextCountry, "", "");
  }

  function onSchoolChange(nextSchool: string) {
    if (nextSchool === schoolCode) return;
    if (!confirmDiscardDirty(dirtyCount)) return;
    applyScope(countryCode, nextSchool, "");
  }

  function onRoleChange(nextRole: string) {
    if (nextRole === selectedRoleKey) return;
    if (!confirmDiscardDirty(dirtyCount)) return;
    applyScope(countryCode, schoolCode, nextRole);
  }

  function toggle(moduleKey: string, field: keyof RbacCrudFlags) {
    if (!canManage) return;
    const mandatory = mandatoryFlagsForModule(catalog?.mandatoryByRole, selectedRoleKey, moduleKey);
    setDraftByModule((current) => {
      const base = current[moduleKey] ?? loadedByModule[moduleKey] ?? emptyCrud();
      return { ...current, [moduleKey]: toggleCrudFlag(base, field, mandatory) };
    });
  }

  async function save() {
    if (!canManage || !selectedRoleKey || !pathComplete || !dirty) return;
    const grants = dirtyModuleKeys.map((moduleKey) => {
      const mandatory = mandatoryFlagsForModule(catalog?.mandatoryByRole, selectedRoleKey, moduleKey);
      return toCrudGrant(moduleKey, applyMandatoryOverlay(draftByModule[moduleKey] ?? emptyCrud(), mandatory));
    });
    setBusy(true);
    try {
      const saved = await rbacApi.patchPermissions({
        roleKey: selectedRoleKey,
        countryCode,
        schoolCode,
        expectedUpdatedAt: matrix?.updatedAt ?? null,
        grants,
      });
      const next = await rbacApi.getConfigured({ roleKey: selectedRoleKey, countryCode, schoolCode });
      const nextMatrix = { ...next, updatedAt: saved.updatedAt ?? next.updatedAt };
      setMatrix(nextMatrix);
      const nextDraft: Record<string, RbacCrudFlags> = {};
      for (const module of nextMatrix.modules ?? []) {
        const mandatory = mandatoryFlagsForModule(catalog?.mandatoryByRole, selectedRoleKey, module.moduleKey);
        nextDraft[module.moduleKey] = applyMandatoryOverlay(toCrudFlags(module), mandatory);
      }
      setDraftByModule(nextDraft);
      showToast("Droits enregistrés", "success");
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      const code = error instanceof ApiError ? error.code : undefined;
      const message = error instanceof ApiError ? error.message : "";
      showToast(
        code === "MANDATORY_PERMISSION"
          ? message || "Droit obligatoire : modification refusée."
          : status === 409
            ? "Conflit : la matrice a été modifiée. Rechargez avant d'enregistrer."
            : message || "Échec de l'enregistrement",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  async function resetOverride(moduleKey: string) {
    if (!canManage || !selectedRoleKey || !pathComplete) return;
    const preservedDirtyDrafts = dirtyModuleKeys.reduce<Record<string, RbacCrudFlags>>((acc, dirtyModuleKey) => {
      if (dirtyModuleKey !== moduleKey && draftByModule[dirtyModuleKey]) {
        acc[dirtyModuleKey] = draftByModule[dirtyModuleKey];
      }
      return acc;
    }, {});
    setBusy(true);
    try {
      const next = await rbacApi.resetOverride({
        roleKey: selectedRoleKey,
        countryCode,
        schoolCode,
        moduleKey,
        expectedUpdatedAt: matrix?.updatedAt ?? null,
      });
      setMatrix(next);
      const nextDraft: Record<string, RbacCrudFlags> = {};
      for (const module of next.modules ?? []) {
        const mandatory = mandatoryFlagsForModule(catalog?.mandatoryByRole, selectedRoleKey, module.moduleKey);
        nextDraft[module.moduleKey] = applyMandatoryOverlay(toCrudFlags(module), mandatory);
      }
      for (const [dirtyModuleKey, preservedDraft] of Object.entries(preservedDirtyDrafts)) {
        if (!nextDraft[dirtyModuleKey]) continue;
        const mandatory = mandatoryFlagsForModule(catalog?.mandatoryByRole, selectedRoleKey, dirtyModuleKey);
        nextDraft[dirtyModuleKey] = applyMandatoryOverlay(toCrudFlags(preservedDraft), mandatory);
      }
      setDraftByModule(nextDraft);
      showToast("Override établissement retiré. L'héritage pays/global s'applique à nouveau.", "success");
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      const message = error instanceof ApiError ? error.message : "";
      showToast(
        status === 409
          ? "Conflit : la matrice a été modifiée. Rechargez avant de réinitialiser."
          : message || "Échec de la réinitialisation",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  async function refreshCatalog() {
    const next = await rbacApi.getCatalog();
    setCatalog(next);
  }

  async function onCreateRole(event: FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    setBusy(true);
    try {
      await rbacApi.createRole({
        roleName: roleForm.roleName.trim(),
        roleCode: roleForm.roleCode.trim() || undefined,
      });
      setRoleForm({ roleName: "", roleCode: "" });
      await refreshCatalog();
      showToast("Rôle créé", "success");
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : "Création impossible.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory(nextOffset = 0) {
    if (!canManage) return;
    setBusy(true);
    try {
      const page = await rbacApi.getHistory({ limit: HISTORY_PAGE_SIZE, offset: nextOffset });
      setHistoryItems(page.items);
      setHistoryOffset(page.offset);
      setHistoryHasMore(page.hasMore);
      setHistoryLimit(page.limit);
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : "Impossible de charger l'historique.", "error");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!canManage || tab !== "history") return;
    void loadHistory(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, tab]);

  async function onRenameRole(role: RbacRole) {
    if (!canManage || isProtectedRole(role, catalog)) return;
    const nextName = editingRoleName.trim();
    if (!nextName || nextName === role.roleName) {
      setEditingRoleId("");
      return;
    }
    setBusy(true);
    try {
      await rbacApi.updateRole(role.id, { roleName: nextName });
      setEditingRoleId("");
      await refreshCatalog();
      showToast("Libellé du rôle mis à jour", "success");
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : "Renommage impossible.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveDisplayLabel(role: RbacRole) {
    if (!canManage) return;
    setBusy(true);
    try {
      const next = editingDisplayLabel.trim();
      if (!next) {
        await rbacApi.resetRoleDisplayLabel(role.id);
      } else {
        await rbacApi.updateRoleDisplayLabel(role.id, next);
      }
      setEditingDisplayRoleId("");
      await refreshCatalog();
      showToast(next ? "Libellé affiché mis à jour" : "Libellé par défaut restauré", "success");
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : "Enregistrement du libellé affiché impossible.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function onResetDisplayLabel(role: RbacRole) {
    if (!canManage) return;
    setBusy(true);
    try {
      await rbacApi.resetRoleDisplayLabel(role.id);
      setEditingDisplayRoleId("");
      await refreshCatalog();
      showToast("Libellé par défaut restauré", "success");
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : "Restauration impossible.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function onToggleRoleStatus(role: RbacRole) {
    if (!canManage || isProtectedRole(role, catalog)) return;
    setBusy(true);
    try {
      if (role.status === "active") {
        await rbacApi.archiveRole(role.id);
        showToast("Rôle archivé. Les attributions existantes restent actives.", "success");
      } else {
        await rbacApi.updateRole(role.id, { status: "active" });
      }
      await refreshCatalog();
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : "Action impossible.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <SectionHeader
        title="Rôles et droits"
        description={
          canManage
            ? "Point canonique Super administrateur : pays → établissement → rôle → tous les modules. PostgreSQL est la source d’autorité."
            : "Consultation réservée. Seul le Super administrateur peut modifier les droits."
        }
        actions={
          <>
            <PrintButton documentTitle="Rôles et droits — Somafrik" />
            {canManage && tab === "permissions" ? (
              <Button size="sm" onClick={() => void save()} disabled={busy || !pathComplete || !dirty}>
                Enregistrer les droits
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mt-4 flex gap-2">
        <Button variant={tab === "permissions" ? "primary" : "secondary"} size="sm" onClick={() => setTab("permissions")}>
          Droits
        </Button>
        <Button variant={tab === "roles" ? "primary" : "secondary"} size="sm" onClick={() => setTab("roles")}>
          Rôles
        </Button>
        {canManage ? (
          <Button variant={tab === "history" ? "primary" : "secondary"} size="sm" onClick={() => setTab("history")}>
            Historique
          </Button>
        ) : null}
      </div>

      {tab === "roles" ? (
        <div className="mt-6 space-y-6">
          {canManage ? (
            <form className="grid gap-4 md:grid-cols-3" onSubmit={(event) => void onCreateRole(event)}>
              <Field label="Libellé du rôle métier" required>
                <Input
                  value={roleForm.roleName}
                  onChange={(event) => setRoleForm((current) => ({ ...current, roleName: event.target.value }))}
                  placeholder="Préfet des études"
                  required
                />
              </Field>
              <Field label="Code technique du rôle (role_key)">
                <Input
                  value={roleForm.roleCode}
                  onChange={(event) => setRoleForm((current) => ({ ...current, roleCode: event.target.value }))}
                  placeholder="PREFET_ETUDES"
                />
              </Field>
              <div className="flex items-end">
                <Button type="submit" size="sm" disabled={busy || !roleForm.roleName.trim()}>
                  Créer le rôle
                </Button>
              </div>
            </form>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-3 text-left">Rôle technique</th>
                  <th className="px-3 py-3 text-left">Libellé par défaut</th>
                  <th className="px-3 py-3 text-left">Libellé affiché</th>
                  <th className="px-3 py-3 text-left">Libellé effectif</th>
                  <th className="px-3 py-3 text-left">Portée</th>
                  <th className="px-3 py-3 text-left">Statut</th>
                  <th className="px-3 py-3 text-left">Utilisateurs actifs</th>
                  <th className="px-3 py-3 text-left">Dernière modification</th>
                  <th className="px-3 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => {
                  const protectedRole = isProtectedRole(role, catalog);
                  const editing = editingRoleId === role.id;
                  const editingDisplay = editingDisplayRoleId === role.id;
                  const defaultLabel = role.defaultLabel || role.roleName;
                  const effectiveLabel = role.effectiveLabel || resolveEffectiveRoleLabel({
                    defaultLabel,
                    displayLabel: role.displayLabel,
                  });
                  return (
                  <tr key={role.id} className="border-b border-line/70">
                    <td className="px-3 py-2.5 font-mono text-xs">{role.roleCode}</td>
                    <td className="px-3 py-2.5 font-medium">
                      {canManage && !protectedRole && editing ? (
                        <Input
                          value={editingRoleName}
                          onChange={(event) => setEditingRoleName(event.target.value)}
                          aria-label={`Libellé ${role.roleCode}`}
                        />
                      ) : (
                        defaultLabel
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {canManage && editingDisplay ? (
                        <Input
                          value={editingDisplayLabel}
                          onChange={(event) => setEditingDisplayLabel(event.target.value)}
                          aria-label={`Libellé affiché ${role.roleCode}`}
                          placeholder={defaultLabel}
                        />
                      ) : (
                        role.displayLabel || "—"
                      )}
                    </td>
                    <td className="px-3 py-2.5">{effectiveLabel || "—"}</td>
                    <td className="px-3 py-2.5">{displayScopeName(role.scope)}</td>
                    <td className="px-3 py-2.5">{displayStatusName(role.status)}</td>
                    <td className="px-3 py-2.5">{role.activeUserCount ?? 0}</td>
                    <td className="px-3 py-2.5">{formatDate(role.updatedAt)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-2">
                        {canManage ? (
                          editingDisplay ? (
                            <Button
                              size="sm"
                              onClick={() => void onSaveDisplayLabel(role)}
                              disabled={busy}
                              aria-label={`Enregistrer le libellé affiché ${role.roleCode}`}
                            >
                              Enregistrer
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setEditingDisplayRoleId(role.id);
                                setEditingDisplayLabel(role.displayLabel || "");
                              }}
                              disabled={busy}
                            >
                              Modifier
                            </Button>
                          )
                        ) : null}
                        {canManage ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void onResetDisplayLabel(role)}
                            disabled={busy || !role.displayLabel}
                          >
                            Restaurer le défaut
                          </Button>
                        ) : null}
                        {canManage && !protectedRole && role.status === "active" ? (
                          editing ? (
                            <Button size="sm" onClick={() => void onRenameRole(role)} disabled={busy || !editingRoleName.trim()}>
                              Enregistrer le libellé
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setEditingRoleId(role.id);
                                setEditingRoleName(role.roleName);
                              }}
                              disabled={busy}
                            >
                              Renommer
                            </Button>
                          )
                        ) : null}
                        {canManage && !protectedRole && role.status === "active" ? (
                          <Button variant="secondary" size="sm" onClick={() => void onToggleRoleStatus(role)} disabled={busy}>
                            Archiver
                          </Button>
                        ) : protectedRole ? (
                          <span className="text-xs text-muted">Protégé</span>
                        ) : (
                          "—"
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === "history" ? (
        <div className="mt-6 space-y-4">
          <h2 className="text-base font-semibold text-ink">Historique des modifications</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-3 text-left">Date / heure</th>
                  <th className="px-3 py-3 text-left">Acteur</th>
                  <th className="px-3 py-3 text-left">Action</th>
                  <th className="px-3 py-3 text-left">Rôle</th>
                  <th className="px-3 py-3 text-left">Module</th>
                  <th className="px-3 py-3 text-left">Portée</th>
                  <th className="px-3 py-3 text-left">Avant → après</th>
                </tr>
              </thead>
              <tbody>
                {historyItems.length ? (
                  historyItems.map((item) => (
                    <tr key={item.id} className="border-b border-line/70">
                      <td className="px-3 py-2.5">{formatDate(item.createdAt)}</td>
                      <td className="px-3 py-2.5">{item.actor}</td>
                      <td className="px-3 py-2.5 font-mono text-xs">{item.action}</td>
                      <td className="px-3 py-2.5">{item.role || "—"}</td>
                      <td className="px-3 py-2.5">{item.moduleKey || "—"}</td>
                      <td className="px-3 py-2.5">{item.scope || "—"}</td>
                      <td className="px-3 py-2.5">{item.summary}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-6 text-center text-muted" colSpan={7}>
                      Aucune modification RBAC enregistrée.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || historyOffset <= 0}
              onClick={() => void loadHistory(Math.max(0, historyOffset - historyLimit))}
            >
              Précédent
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || !historyHasMore}
              onClick={() => void loadHistory(historyOffset + historyLimit)}
            >
              Suivant
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-2 rounded-xl border border-line bg-slate-50/80 p-4 text-sm text-muted">
            <p>
              <span className="font-semibold text-ink">A.</span> Rôles système protégés : SUPER_ADMIN, COUNTRY_ADMIN,
              SCHOOL_ADMIN. <span className="font-semibold text-ink">B.</span> Rôles métier établissement (catalogue
              PostgreSQL). <span className="font-semibold text-ink">C.</span> Droits par module.
            </p>
            <p>Résolution restrictive : établissement → pays → global → refus par défaut. Multi-rôle = union des rôles actifs.</p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <Field label="Pays" hint="Pays canoniques">
              <Select
                id="rbac-country"
                value={countryCode}
                onChange={(event) => onCountryChange(event.target.value)}
                options={countryOptions}
              />
            </Field>
            <Field label="Établissement" hint="Établissements du pays">
              <Select
                id="rbac-school"
                value={schoolCode}
                onChange={(event) => onSchoolChange(event.target.value)}
                options={schoolOptions}
                disabled={!countryCode}
              />
            </Field>
            <Field label="Rôle cible" hint="Rôles applicables à ce périmètre">
              <Select
                id="rbac-role"
                value={selectedRoleKey}
                onChange={(event) => onRoleChange(event.target.value)}
                options={roleOptions}
                disabled={!schoolCode}
              />
            </Field>
          </div>

          {selectedCountry && selectedSchool && selectedRole ? (
            <p className="mt-4 rounded-lg border border-line bg-white px-4 py-3 text-sm text-muted">
              Périmètre :{" "}
              <span className="font-semibold text-ink">
                {selectedCountry.code} — {selectedCountry.name}
              </span>
              {" → "}
              <span className="font-semibold text-ink">
                {selectedSchool.code} — {selectedSchool.name}
              </span>
              {" · Rôle "}
              <span className="font-semibold text-brand">
                {selectedRole.effectiveLabel || selectedRole.roleName} ({selectedRole.roleCode})
              </span>
            </p>
          ) : null}

          {!pathComplete ? (
            <p className="mt-6 rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
              Sélectionnez un pays, un établissement et un rôle pour afficher tous les modules.
            </p>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-brand-50 px-4 py-3 text-sm font-medium text-brand">
                <p>
                  Matrice complète — {matrixModules.length} module{matrixModules.length > 1 ? "s" : ""} pour{" "}
                  {selectedRole?.effectiveLabel || selectedRole?.roleName}.
                </p>
                <p data-testid="rbac-dirty-count" className={dirty ? "text-ink" : "text-muted"}>
                  {dirty
                    ? `${dirtyCount} module${dirtyCount > 1 ? "s" : ""} modifié${dirtyCount > 1 ? "s" : ""}`
                    : "Aucun changement"}
                </p>
              </div>
              <p className="mt-2 text-xs text-muted">
                Case verrouillée (cadenas) : invariant de rôle ou prérequis de lecture tant qu’une action de
                création, modification ou suppression est active. Impossible à décocher ici ; le serveur refuse
                aussi toute modification contraire.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table data-testid="rbac-permissions-matrix" className="min-w-[720px] w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                      <th className="px-3 py-3 text-left font-semibold">Module</th>
                      {CRUD_ACTIONS.map((action) => (
                        <th key={action.key} className="px-3 py-3 text-center font-semibold">
                          {action.label}
                        </th>
                      ))}
                      <th className="px-3 py-3 text-left font-semibold">Source</th>
                      <th className="px-3 py-3 text-left font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrixModules.map((module) => {
                      const flags = draftByModule[module.moduleKey] ?? loadedByModule[module.moduleKey] ?? emptyCrud();
                      const mandatory = mandatoryFlagsForModule(
                        catalog?.mandatoryByRole,
                        selectedRoleKey,
                        module.moduleKey,
                      );
                      const hasSchoolOverride = module.source === "school" || module.configured === true;
                      return (
                        <tr
                          key={module.moduleKey}
                          data-module-key={module.moduleKey}
                          className="border-b border-line/70"
                        >
                          <td className="px-3 py-2.5 font-medium text-ink">{module.moduleName}</td>
                          {CRUD_ACTIONS.map((action) => {
                            const lock = describeActionLock({
                              action: action.action,
                              flags,
                              mandatory,
                            });
                            const tooltip = lock.locked ? lockTooltip(lock.reason) : undefined;
                            return (
                              <td key={action.key} className="px-3 py-2.5 text-center">
                                <label className="inline-flex items-center justify-center gap-1" title={tooltip}>
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 accent-brand disabled:cursor-not-allowed disabled:opacity-80"
                                    checked={Boolean(flags[action.key])}
                                    disabled={!canManage || busy || lock.locked}
                                    onChange={() => toggle(module.moduleKey, action.key)}
                                    aria-label={`${module.moduleName} ${action.label}`}
                                    aria-disabled={lock.locked || undefined}
                                  />
                                  {lock.locked ? <LockIcon label={tooltip || ""} /> : null}
                                </label>
                              </td>
                            );
                          })}
                          <td className="px-3 py-2.5 text-muted">{sourceLabel(module.source)}</td>
                          <td className="px-3 py-2.5">
                            {hasSchoolOverride ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void resetOverride(module.moduleKey)}
                                disabled={busy}
                                aria-label={`Réinitialiser ${module.moduleName}`}
                              >
                                Réinitialiser
                              </Button>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {canManage ? (
                <div className="mt-4 flex justify-end">
                  <Button size="sm" onClick={() => void save()} disabled={busy || !dirty}>
                    Enregistrer les droits
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </Card>
  );
}
