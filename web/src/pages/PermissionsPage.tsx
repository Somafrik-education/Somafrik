import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { canManageRolePermissions } from "../lib/permissions";
import { formatCountryOption, formatSchoolOption, schoolsForCountry } from "../lib/superadminCrudPath";
import { scopedCountries, scopedSchools } from "../lib/scope";
import { usePermissionContext } from "../lib/usePermissionContext";
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
  type RbacModule,
  type RbacRole,
} from "../lib/rbacApi";

const CRUD_ACTIONS = [
  { key: "canCreate" as const, label: "CREATE" },
  { key: "canRead" as const, label: "READ" },
  { key: "canUpdate" as const, label: "UPDATE" },
  { key: "canDelete" as const, label: "DELETE" },
];

type TabKey = "permissions" | "roles";

function emptyCrud(): Pick<RbacModule, "canCreate" | "canRead" | "canUpdate" | "canDelete"> {
  return { canCreate: false, canRead: false, canUpdate: false, canDelete: false };
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
  const [selectedModuleKey, setSelectedModuleKey] = useState("");
  const [matrix, setMatrix] = useState<RbacConfiguredMatrix | null>(null);
  const [draft, setDraft] = useState(emptyCrud());
  const [busy, setBusy] = useState(false);
  const [roleForm, setRoleForm] = useState({ roleName: "", roleCode: "" });

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
        label: `${role.roleName} (${role.roleCode})`,
      })),
    ],
    [activeRoles, schoolCode],
  );

  const modules = matrix?.modules?.length ? matrix.modules : catalog?.modules ?? [];
  const moduleOptions = useMemo(
    () => [
      {
        value: "",
        label: selectedRoleKey ? "Choisir un module fonctionnel…" : "Sélectionnez d'abord un rôle",
      },
      ...modules.map((module) => ({ value: module.moduleKey, label: module.moduleName })),
    ],
    [modules, selectedRoleKey],
  );

  const selectedCountry = countries.find((country) => country.code === countryCode);
  const selectedSchool = schoolsInCountry.find((school) => school.code === schoolCode);
  const selectedRole = roles.find((role) => role.roleCode === selectedRoleKey);
  const selectedModule = modules.find((module) => module.moduleKey === selectedModuleKey);
  const pathComplete = Boolean(countryCode && schoolCode && selectedRoleKey && selectedModuleKey);

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
    setSchoolCode("");
    setSelectedRoleKey("");
    setSelectedModuleKey("");
    setMatrix(null);
  }, [countryCode]);

  useEffect(() => {
    setSelectedRoleKey("");
    setSelectedModuleKey("");
    setMatrix(null);
  }, [schoolCode]);

  useEffect(() => {
    setSelectedModuleKey("");
  }, [selectedRoleKey]);

  useEffect(() => {
    if (!canManage || !selectedRoleKey || !countryCode || !schoolCode) return;
    let cancelled = false;
    setBusy(true);
    void rbacApi
      .getConfigured({ roleKey: selectedRoleKey, countryCode, schoolCode })
      .then((payload) => {
        if (cancelled) return;
        setMatrix(payload);
      })
      .catch(() => {
        if (!cancelled) showToast("Impossible de charger la matrice CRUD.", "error");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, selectedRoleKey, countryCode, schoolCode]);

  useEffect(() => {
    if (!selectedModule) {
      setDraft(emptyCrud());
      return;
    }
    setDraft({
      canCreate: Boolean(selectedModule.canCreate),
      canRead: Boolean(selectedModule.canRead),
      canUpdate: Boolean(selectedModule.canUpdate),
      canDelete: Boolean(selectedModule.canDelete),
    });
  }, [selectedModule]);

  function toggle(field: keyof ReturnType<typeof emptyCrud>) {
    if (!canManage) return;
    setDraft((current) => ({ ...current, [field]: !current[field] }));
  }

  async function save() {
    if (!canManage || !selectedRoleKey || !selectedModuleKey) return;
    setBusy(true);
    try {
      const saved = await rbacApi.patchPermissions({
        roleKey: selectedRoleKey,
        countryCode,
        schoolCode,
        expectedUpdatedAt: matrix?.updatedAt ?? null,
        grants: [
          {
            moduleKey: selectedModuleKey,
            ...draft,
          },
        ],
      });
      const next = await rbacApi.getConfigured({ roleKey: selectedRoleKey, countryCode, schoolCode });
      setMatrix({ ...next, updatedAt: saved.updatedAt ?? next.updatedAt });
      showToast("Permissions enregistrées", "success");
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      showToast(
        status === 409
          ? "Conflit : la matrice a été modifiée. Rechargez avant d'enregistrer."
          : "Échec de l'enregistrement",
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

  async function onToggleRoleStatus(role: RbacRole) {
    if (!canManage || role.systemProtected) return;
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
        title="Rôles & permissions"
        description={
          canManage
            ? "Point canonique Superadmin : pays → établissement → rôle → module → CRUD. PostgreSQL est la source d’autorité."
            : "Consultation réservée. Seul le Superadmin peut modifier les droits."
        }
        actions={
          <>
            <PrintButton documentTitle="Rôles et permissions — Somafrik" />
            {canManage && tab === "permissions" ? (
              <Button size="sm" onClick={() => void save()} disabled={busy || !pathComplete}>
                Enregistrer
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mt-4 flex gap-2">
        <Button variant={tab === "permissions" ? "primary" : "secondary"} size="sm" onClick={() => setTab("permissions")}>
          Permissions
        </Button>
        <Button variant={tab === "roles" ? "primary" : "secondary"} size="sm" onClick={() => setTab("roles")}>
          Rôles
        </Button>
      </div>

      {tab === "roles" ? (
        <div className="mt-6 space-y-6">
          {canManage ? (
            <form className="grid gap-4 md:grid-cols-3" onSubmit={(event) => void onCreateRole(event)}>
              <Field label="Libellé du rôle métier">
                <Input
                  value={roleForm.roleName}
                  onChange={(event) => setRoleForm((current) => ({ ...current, roleName: event.target.value }))}
                  placeholder="Préfet des études"
                />
              </Field>
              <Field label="role_key (optionnel)">
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
                  <th className="px-3 py-3 text-left">Nom</th>
                  <th className="px-3 py-3 text-left">role_key</th>
                  <th className="px-3 py-3 text-left">Portée</th>
                  <th className="px-3 py-3 text-left">Statut</th>
                  <th className="px-3 py-3 text-left">Utilisateurs actifs</th>
                  <th className="px-3 py-3 text-left">Dernière modification</th>
                  <th className="px-3 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id} className="border-b border-line/70">
                    <td className="px-3 py-2.5 font-medium">{role.roleName}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{role.roleCode}</td>
                    <td className="px-3 py-2.5">{role.scope}</td>
                    <td className="px-3 py-2.5">{role.status}</td>
                    <td className="px-3 py-2.5">{role.activeUserCount ?? 0}</td>
                    <td className="px-3 py-2.5">{formatDate(role.updatedAt)}</td>
                    <td className="px-3 py-2.5">
                      {canManage && !role.systemProtected && role.status === "active" ? (
                        <Button variant="secondary" size="sm" onClick={() => void onToggleRoleStatus(role)} disabled={busy}>
                          Archiver
                        </Button>
                      ) : role.systemProtected ? (
                        <span className="text-xs text-muted">Protégé</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-2 rounded-xl border border-line bg-slate-50/80 p-4 text-sm text-muted">
            <p>
              <span className="font-semibold text-ink">A.</span> Rôles système protégés : SUPER_ADMIN, COUNTRY_ADMIN,
              SCHOOL_ADMIN. <span className="font-semibold text-ink">B.</span> Rôles métier établissement (catalogue
              PostgreSQL). <span className="font-semibold text-ink">C.</span> Permissions CRUD par module.
            </p>
            <p>Résolution fail-closed : établissement → pays → global → DENY. Multi-rôle = union des rôles actifs.</p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Pays" hint="Pays canoniques">
              <Select
                id="rbac-country"
                value={countryCode}
                onChange={(event) => setCountryCode(event.target.value)}
                options={countryOptions}
              />
            </Field>
            <Field label="Établissement" hint="Établissements du pays">
              <Select
                id="rbac-school"
                value={schoolCode}
                onChange={(event) => setSchoolCode(event.target.value)}
                options={schoolOptions}
                disabled={!countryCode}
              />
            </Field>
            <Field label="Rôle cible" hint="Rôles applicables à ce scope">
              <Select
                id="rbac-role"
                value={selectedRoleKey}
                onChange={(event) => setSelectedRoleKey(event.target.value)}
                options={roleOptions}
                disabled={!schoolCode}
              />
            </Field>
            <Field label="Module fonctionnel" hint="Catalogue réel Web + Mobile">
              <Select
                id="rbac-module"
                value={selectedModuleKey}
                onChange={(event) => setSelectedModuleKey(event.target.value)}
                options={moduleOptions}
                disabled={!selectedRoleKey}
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
                {selectedRole.roleName} ({selectedRole.roleCode})
              </span>
            </p>
          ) : null}

          {!pathComplete ? (
            <p className="mt-6 rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
              Sélectionnez un pays, un établissement, un rôle, puis un module pour afficher les droits CRUD.
            </p>
          ) : (
            <>
              <p className="mt-4 rounded-lg bg-brand-50 px-4 py-3 text-sm font-medium text-brand">
                Module « {selectedModule?.moduleName} » — CREATE / READ / UPDATE / DELETE pour{" "}
                {selectedRole?.roleName}.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                      <th className="px-3 py-3 text-left font-semibold">Module</th>
                      {CRUD_ACTIONS.map((action) => (
                        <th key={action.key} className="px-3 py-3 text-center font-semibold">
                          {action.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-line/70">
                      <td className="px-3 py-2.5 font-medium text-ink">{selectedModule?.moduleName}</td>
                      {CRUD_ACTIONS.map((action) => (
                        <td key={action.key} className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer accent-brand disabled:cursor-not-allowed"
                            checked={Boolean(draft[action.key])}
                            disabled={!canManage || busy}
                            onChange={() => toggle(action.key)}
                            aria-label={`${selectedModule?.moduleName} ${action.label}`}
                          />
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}
